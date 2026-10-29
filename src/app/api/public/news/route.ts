import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { toWebsiteNewsItem } from "@/lib/website-news";

/**
 * GET /api/public/news - the articles the team picked for /news on the D|R|P website (Website ->
 * News), newest first. The website reads it when it builds (scripts/sync-news.mjs). Public by
 * design: headlines, summaries and links the website shows anyway.
 */
export const dynamic = "force-dynamic";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

export async function GET() {
  const { data, error } = await createAdminClient()
    .from("website_news")
    .select("*")
    .order("published_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) {
    return NextResponse.json({ error: "The news is temporarily unavailable." }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json((data ?? []).map(toWebsiteNewsItem), { headers: HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
