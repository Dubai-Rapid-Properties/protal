import { imagesOf, type UnitRow } from "@/lib/website-homes";
import { bedsToText, seasonsToText } from "@/lib/website-options";
import type { WebsiteDefaults } from "./website-form";

const str = (v: number | string | null | undefined) => (v == null ? "" : String(v));

/** The unit's website details as the Website form shows them. */
export function websiteDefaults(u: UnitRow): WebsiteDefaults {
  return {
    published: u.website_published,
    title: u.website_title ?? "",
    slug: u.website_slug ?? "",
    type: u.website_type ?? "",
    area: u.website_area ?? "",
    building: u.website_building ?? "",
    tag: u.website_tag ?? "",
    description: u.website_description ?? "",
    highlights: (u.website_highlights ?? []).join("\n"),
    houseRules: (u.website_house_rules ?? []).join("\n"),
    amenities: u.website_amenities ?? [],
    images: imagesOf(u),
    lat: u.website_lat == null ? "" : String(u.website_lat),
    lng: u.website_lng == null ? "" : String(u.website_lng),
    mapsUrl: u.website_maps_url ?? "",
    checkIn: u.website_check_in ?? "15:00",
    checkOut: u.website_check_out ?? "11:00",
    seasons: seasonsToText(u.website_seasons),
    // null until migration 0030 adds the column: the form then leaves the field out.
    beds: "website_beds" in u ? bedsToText(u.website_beds) : null,
    nightlyRate: str(u.base_nightly_rate_aed),
    weekendRate: str(u.weekend_rate_aed),
    cleaningFee: str(u.cleaning_fee_aed),
    weeklyDiscount: str(u.weekly_discount_pct),
    monthlyDiscount: str(u.monthly_discount_pct),
    maxGuests: str(u.max_guests),
  };
}
