import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { currentPermitNumbers, toWebsiteHome } from "@/lib/website-homes";
import { dubaiToday } from "@/lib/calendar";
import { PUBLIC_HEADERS } from "@/lib/website-api";

/**
 * GET /api/public/homes - the holiday homes published to the Holiday Homes
 * website, in the shape of its own Property type. Public by design: it carries
 * only what the website shows anyway (no owner, address or contact data). The DET permit
 * number is included because Dubai requires it on every holiday-home listing.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("units")
    .select("*")
    .eq("website_published", true)
    .eq("is_active", true)
    .order("website_title");
  if (error) {
    return NextResponse.json({ error: "Homes are temporarily unavailable." }, { status: 503, headers: PUBLIC_HEADERS });
  }
  const units = data ?? [];
  // A missing permit only hides the number on the website; it never hides the home.
  const { data: permits } = units.length
    ? await supabase
        .from("holiday_home_permits")
        .select("unit_id, permit_number, status, issued_on, expires_on")
        .in("unit_id", units.map((u) => u.id))
    : { data: [] };
  const permitFor = currentPermitNumbers(permits ?? [], dubaiToday());
  const homes = units.map((u) => toWebsiteHome(u, permitFor.get(u.id) ?? null)).filter((h) => h !== null);
  return NextResponse.json({ homes }, { headers: PUBLIC_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}
