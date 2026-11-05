import { requireCapability } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/domain/shared";
import { env } from "@/lib/env";
import { listingBookmarklet } from "@/lib/airbnb/listing-collect";
import { ListingImport } from "./import";

export const metadata = { title: "Import from Airbnb" };

/**
 * The "Import listing to D|R|P" button opens this page with the listing in
 * the URL fragment (#...), which never reaches the server or its logs; staff
 * pick the unit, the photos are copied to the portal, and the unit's Website
 * form opens filled in, to check and save. Nothing is published from here.
 */
export default async function FromAirbnbListingPage({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  await requireCapability("units.manage");
  const { unit } = await searchParams;
  const supabase = await createClient();
  const { data: units } = await supabase
    .from("v_units_overview")
    .select("id, unit_number, property_name")
    .eq("is_active", true)
    .in("operating_mode", ["short_term", "both"])
    .order("property_name")
    .order("unit_number");
  const { data: buildings } = await supabase.from("properties").select("name").eq("is_active", true).order("name");
  const list = (units ?? []).map((u) => ({ id: u.id!, label: `${u.property_name} · ${u.unit_number}` }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Units", href: "/units" }]}
        title="Import from Airbnb"
        description="Fills a unit's page on the Holiday Homes website from its Airbnb listing (title, description, amenities, photos), and its rates from the listing's Pricing page."
      />
      <ListingImport
        bookmarklet={listingBookmarklet(`${env.adminUrl}/units/from-airbnb`)}
        units={list}
        buildings={(buildings ?? []).map((b) => b.name)}
        presetUnitId={list.some((u) => u.id === unit) ? unit! : null}
      />
    </>
  );
}
