import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { toWebsiteTeamMember } from "@/lib/website-team";

/**
 * GET /api/public/team - the active team for the D|R|P website (About page,
 * listing agents), in order. The website reads it when it builds.
 *
 * Public by design: name, role, bio, photo, RERA BRN and the contact details
 * staff chose to show on the website.
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
    .from("website_team")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  if (error) {
    return NextResponse.json({ error: "The team is temporarily unavailable." }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json((data ?? []).map(toWebsiteTeamMember), { headers: HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
