import { createClient } from "@/lib/supabase/server";

/** What the listing form offers: areas already used, the team (then any other agent named before), and units to link. */
export async function listingFormOptions() {
  const supabase = await createClient();
  const [listings, units, team] = await Promise.all([
    supabase.from("website_listings").select("area, agent"),
    supabase
      .from("v_units_overview")
      .select("id, unit_number, property_name")
      .eq("is_active", true)
      .order("property_name")
      .order("unit_number"),
    supabase.from("website_team").select("name").eq("is_active", true).order("sort_order").order("name"),
  ]);
  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) => a.localeCompare(b));
  return {
    areas: distinct((listings.data ?? []).map((l) => l.area)),
    agents: [
      ...new Set([
        ...(team.data ?? []).map((m) => m.name),
        ...distinct((listings.data ?? []).map((l) => l.agent)),
      ]),
    ],
    units: (units.data ?? []).map((u) => ({ id: u.id!, label: `${u.property_name} · ${u.unit_number}` })),
  };
}
