import type { Tables } from "@/lib/db/database.types";

/**
 * News on the D|R|P website (/news): articles the team picks under Website -> News,
 * from any publication, shown as a headline, a short summary and a link to the
 * publisher's site (migration 0064). The website reads them from /api/public/news.
 */

export type WebsiteNewsItem = {
  url: string;
  title: string;
  source: string;
  summary: string | null;
  image: string | null;
  /** yyyy-mm-dd */
  date: string;
};

export const toWebsiteNewsItem = (row: Tables<"website_news">): WebsiteNewsItem => ({
  url: row.url,
  title: row.title,
  source: row.source,
  summary: row.summary,
  image: row.image_url,
  date: row.published_on,
});

/** Publications by web address, for the source name of a pasted link. */
const PUBLICATIONS: [RegExp, string][] = [
  [/(^|\.)arabianbusiness\.com$/, "Arabian Business"],
  [/(^|\.)lovin\.co$/, "Lovin Dubai"],
  [/(^|\.)dxbinteract\.com$/, "DXB Interact"],
  [/(^|\.)forbesmiddleeast\.com$/, "Forbes Middle East"],
  [/(^|\.)forbes\.com$/, "Forbes"],
  [/(^|\.)thenationalnews\.com$/, "The National"],
  [/(^|\.)gulfnews\.com$/, "Gulf News"],
  [/(^|\.)khaleejtimes\.com$/, "Khaleej Times"],
  [/(^|\.)zawya\.com$/, "Zawya"],
  [/(^|\.)gulfbusiness\.com$/, "Gulf Business"],
  [/(^|\.)timeoutdubai\.com$/, "Time Out Dubai"],
  [/(^|\.)whatson\.ae$/, "What's On"],
  [/(^|\.)bloomberg\.com$/, "Bloomberg"],
  [/(^|\.)reuters\.com$/, "Reuters"],
  [/(^|\.)cnbc\.com$/, "CNBC"],
  [/(^|\.)propertyfinder\.ae$/, "Property Finder"],
  [/(^|\.)bayut\.com$/, "Bayut"],
  [/(^|\.)dubailand\.gov\.ae$/, "Dubai Land Department"],
];

/** "Arabian Business" for an arabianbusiness.com link; null for a publication not on the list. */
export function publicationOf(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  return PUBLICATIONS.find(([re]) => re.test(host))?.[1] ?? null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, " ")
    .trim();

/** A short summary, cut at a word: never the article itself. */
export const summarize = (s: string, max = 300) => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, "")}…`);

export type ArticleDetails = { title: string | null; summary: string | null; image: string | null; date: string | null; source: string | null };

/** What an article page says about itself (Open Graph and the usual meta tags). */
export function readArticlePage(html: string, url: string): ArticleDetails {
  const head = html.slice(0, 300_000);
  const meta = (...names: string[]) => {
    for (const name of names) {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
      const tag = head.match(re)?.[0];
      const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
      if (content?.trim()) return decode(content);
    }
    return null;
  };
  const title = meta("og:title", "twitter:title") ?? (head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(head.match(/<title[^>]*>([^<]*)<\/title>/i)![1]) : null);
  const description = meta("og:description", "twitter:description", "description");
  let image = meta("og:image", "og:image:url", "twitter:image");
  if (image) {
    try {
      image = new URL(image, url).toString();
    } catch {
      image = null;
    }
  }
  const published = meta("article:published_time", "og:published_time", "date", "pubdate");
  const t = published ? Date.parse(published) : NaN;
  return {
    title: title ? title.slice(0, 300) : null,
    summary: description ? summarize(description) : null,
    image: image && image.startsWith("https://") ? image : null,
    date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null,
    source: publicationOf(url) ?? meta("og:site_name"),
  };
}

/**
 * Reads a pasted article's headline, summary, image and date, as a link preview does. Asks once,
 * saying who is asking; a publication that refuses (many answer 403 to anything but a browser) is
 * left alone and staff type the details in.
 */
export async function fetchArticleDetails(url: string): Promise<ArticleDetails | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "text/html", "user-agent": "DRP-portal/1.0 (link preview; +https://dubairapidproperties.com)" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) return null;
    return readArticlePage(await res.text(), url);
  } catch {
    return null;
  }
}
