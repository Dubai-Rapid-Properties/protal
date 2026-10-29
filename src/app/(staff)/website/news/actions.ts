"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { rebuildWebsite } from "@/lib/website";
import { fetchArticleDetails, publicationOf, summarize } from "@/lib/website-news";

export type NewsValues = { url: string; title: string; source: string; summary: string; image: string; date: string };
/** `added`: when the last article was added, so the form starts empty again. */
export type NewsState = { error?: string; success?: string; values?: NewsValues; added?: number };

const NOT_ALLOWED = "You do not have permission to edit the website news.";

const https = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => /^https:\/\/[^\s]+\.[^\s]+$/.test(v), "Paste the article's full link (https://…)");

const schema = z.object({
  url: https,
  title: z.string().trim().max(300),
  source: z.string().trim().max(80),
  summary: z.string().trim().max(600),
  image: z.union([z.literal(""), https]),
  date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
});

/**
 * Adds an article to /news on the website. Blank fields are filled from the article page when the
 * publication allows it to be read; when it doesn't, staff are asked for the headline and the
 * publication, with the rest kept as typed.
 */
export async function addNews(_prev: NewsState, formData: FormData): Promise<NewsState> {
  const profile = await requireProfile();
  if (!can(profile.role, "website.manage")) return { error: NOT_ALLOWED };
  const raw = Object.fromEntries(["url", "title", "source", "summary", "image", "date"].map((k) => [k, String(formData.get(k) ?? "")]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values: raw as NewsValues };
  const v = { ...parsed.data, url: parsed.data.url.replace(/#.*$/, "") };

  if (!v.title || !v.source || !v.summary || !v.image || !v.date) {
    const found = await fetchArticleDetails(v.url);
    v.title ||= found?.title ?? "";
    v.source ||= found?.source ?? publicationOf(v.url) ?? "";
    v.summary ||= found?.summary ?? "";
    v.image ||= found?.image ?? "";
    v.date ||= found?.date ?? "";
    if (!v.title || v.title.length < 5 || !v.source) {
      return {
        error: found
          ? "Enter the headline and the publication: the article page doesn't give them."
          : "That site doesn't let the portal read its pages. Enter the headline and the publication (a summary helps too), then add it again.",
        values: v,
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("website_news").insert({
    url: v.url,
    title: v.title,
    source: v.source,
    summary: v.summary ? summarize(v.summary) : null,
    image_url: v.image || null,
    ...(v.date ? { published_on: v.date } : {}),
    created_by: profile.id,
  });
  if (error) {
    if (error.code === "23505") return { error: "That article is already on the website.", values: v };
    if (/website_news/.test(error.message) && /exist|relation/i.test(error.message))
      return { error: "The database is not up to date yet: run npm run db:migrate (migration 0064).", values: v };
    return { error: error.message, values: v };
  }
  const rebuild = await rebuildWebsite();
  revalidatePath("/website/news");
  return {
    added: Date.now(),
    success: rebuild.started
      ? `Added "${v.title}". The website is rebuilding; it appears on /news in a few minutes.`
      : `Added "${v.title}". It appears on /news with the website's next build.`,
  };
}

export async function deleteNews(id: string): Promise<{ error?: string }> {
  const profile = await requireProfile();
  if (!can(profile.role, "website.manage")) return { error: NOT_ALLOWED };
  if (!z.string().uuid().safeParse(id).success) return { error: "Article not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("website_news").delete().eq("id", id);
  if (error) return { error: error.message };
  await rebuildWebsite();
  revalidatePath("/website/news");
  return {};
}
