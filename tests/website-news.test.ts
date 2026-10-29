import { test } from "node:test";
import assert from "node:assert/strict";
import { publicationOf, readArticlePage, summarize, toWebsiteNewsItem } from "@/lib/website-news";

test("names the publication of a pasted link", () => {
  assert.equal(publicationOf("https://www.arabianbusiness.com/industries/real-estate/some-story"), "Arabian Business");
  assert.equal(publicationOf("https://lovin.co/dubai/en/news/some-story/"), "Lovin Dubai");
  assert.equal(publicationOf("https://dxbinteract.com/insights/q3-2026"), "DXB Interact");
  assert.equal(publicationOf("https://www.forbesmiddleeast.com/industry/real-estate/x"), "Forbes Middle East");
  assert.equal(publicationOf("https://www.forbes.com/sites/x"), "Forbes");
  assert.equal(publicationOf("https://example.com/x"), null);
  assert.equal(publicationOf("not a link"), null);
});

test("reads an article page's headline, summary, image and date", () => {
  const html = `<html><head><title>Fallback title</title>
    <meta property="og:title" content="Dubai prime prices &amp; rents rise in Q3">
    <meta name="description" content="Short description.">
    <meta property="og:description" content="Prime villa prices rose again, &quot;led&quot; by Palm Jumeirah.">
    <meta property="og:image" content="/images/story.jpg">
    <meta property="og:site_name" content="Some Site">
    <meta property="article:published_time" content="2026-10-27T08:15:00+04:00">
  </head><body>…</body></html>`;
  assert.deepEqual(readArticlePage(html, "https://www.thenationalnews.com/business/property/x"), {
    title: "Dubai prime prices & rents rise in Q3",
    summary: 'Prime villa prices rose again, "led" by Palm Jumeirah.',
    image: "https://www.thenationalnews.com/images/story.jpg",
    date: "2026-10-27",
    source: "The National",
  });
  // A page with only a <title>, from a publication not on the list.
  assert.deepEqual(readArticlePage("<title>Just a title</title>", "https://example.com/x"), {
    title: "Just a title",
    summary: null,
    image: null,
    date: null,
    source: null,
  });
});

test("a summary is a few lines, never the article", () => {
  const long = "word ".repeat(200).trim();
  const s = summarize(long);
  assert.ok(s.length <= 301 && s.endsWith("…"));
  assert.equal(summarize("Short."), "Short.");
});

test("the website gets each article as it shows it", () => {
  assert.deepEqual(
    toWebsiteNewsItem({
      id: "1",
      url: "https://lovin.co/dubai/en/x",
      title: "A Dubai story",
      source: "Lovin Dubai",
      summary: null,
      image_url: null,
      published_on: "2026-10-29",
      created_by: null,
      created_at: "2026-10-29T08:00:00Z",
    }),
    { url: "https://lovin.co/dubai/en/x", title: "A Dubai story", source: "Lovin Dubai", summary: null, image: null, date: "2026-10-29" }
  );
});
