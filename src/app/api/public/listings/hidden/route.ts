import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * GET /api/public/listings/hidden - the web addresses of listings set to
 * "Hidden" here, or deleted from the website (status removed). The website leaves a Property Finder listing with the same
 * address off its pages, which is how a Property Finder listing is hidden
 * from the website without touching Property Finder.
 */
export const dynamic = "force-dynamic";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("website_listings").select("slug").in("status", ["hidden", "removed"]);
  if (error) {
    return NextResponse.json({ error: "Listings are temporarily unavailable." }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json((data ?? []).map((r) => r.slug), { headers: HEADERS });
}
