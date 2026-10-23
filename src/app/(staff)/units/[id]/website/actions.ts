"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { slugify } from "@/lib/listings";
import { isAirbnbPhotoUrl } from "@/lib/airbnb/listing-page";
import { WEBSITE_AMENITIES, WEBSITE_TYPES, parseBeds, parseSeasons } from "@/lib/website-options";

export type WebsiteState = { error?: string; success?: string };

const lines = (s: string | undefined) => (s ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
const numOrNull = z.union([z.literal("").transform(() => null), z.coerce.number()]).nullable();

const schema = z.object({
  published: z.boolean(),
  title: z.string().trim().max(200),
  slug: z.string().trim().max(120),
  type: z.union([z.literal(""), z.enum(WEBSITE_TYPES)]),
  area: z.string().trim().max(80),
  building: z.string().trim().max(120),
  tag: z.string().trim().max(60),
  description: z.string().max(20000),
  highlights: z.string().max(5000),
  houseRules: z.string().max(5000),
  amenities: z.array(z.string()).refine((a) => a.every((x) => x in WEBSITE_AMENITIES), "Unknown amenity"),
  images: z
    .array(z.string().regex(/^https:\/\/\S+$/, "Photo addresses must start with https://"))
    .max(60)
    .refine((a) => !a.some(isAirbnbPhotoUrl), "Airbnb's photo addresses cannot go on the website: use Import from Airbnb, which copies the photos."),
  lat: numOrNull,
  lng: numOrNull,
  mapsUrl: z.union([z.literal(""), z.string().url().startsWith("https://")]),
  checkIn: z.string().regex(/^\d{2}:\d{2}$/, "Check-in time like 15:00"),
  checkOut: z.string().regex(/^\d{2}:\d{2}$/, "Check-out time like 11:00"),
  seasons: z.string().max(5000),
  beds: z.string().max(3000),
  // The unit's own prices and guests, shown on the website.
  nightlyRate: z.coerce.number({ message: "Enter the nightly rate" }).positive("Enter the nightly rate").max(1_000_000),
  weekendRate: numOrNull.pipe(z.number().min(0).max(1_000_000).nullable()),
  cleaningFee: numOrNull.pipe(z.number().min(0).max(1_000_000).nullable()),
  weeklyDiscount: numOrNull.pipe(z.number().min(0, "Discounts are 0 to 99%").max(99, "Discounts are 0 to 99%").nullable()),
  monthlyDiscount: numOrNull.pipe(z.number().min(0, "Discounts are 0 to 99%").max(99, "Discounts are 0 to 99%").nullable()),
  maxGuests: z.coerce.number({ message: "Enter max guests" }).int().min(1, "Enter max guests").max(30),
});

export async function saveUnitWebsite(unitId: string, _prev: WebsiteState, formData: FormData): Promise<WebsiteState> {
  const profile = await requireProfile();
  if (!can(profile.role, "units.manage")) return { error: "You do not have permission to edit units." };

  let images: unknown = [];
  try {
    images = JSON.parse(String(formData.get("images") ?? "[]"));
  } catch {
    return { error: "Photos could not be read. Reload the page and try again." };
  }
  const parsed = schema.safeParse({
    published: formData.get("published") === "on",
    title: formData.get("title") ?? "",
    slug: formData.get("slug") ?? "",
    type: formData.get("type") ?? "",
    area: formData.get("area") ?? "",
    building: formData.get("building") ?? "",
    tag: formData.get("tag") ?? "",
    description: formData.get("description") ?? "",
    highlights: formData.get("highlights") ?? "",
    houseRules: formData.get("houseRules") ?? "",
    amenities: formData.getAll("amenities").map(String),
    images,
    lat: formData.get("lat") ?? "",
    lng: formData.get("lng") ?? "",
    mapsUrl: formData.get("mapsUrl") ?? "",
    checkIn: formData.get("checkIn") ?? "",
    checkOut: formData.get("checkOut") ?? "",
    seasons: formData.get("seasons") ?? "",
    beds: formData.get("beds") ?? "",
    nightlyRate: formData.get("nightlyRate") ?? "",
    weekendRate: formData.get("weekendRate") ?? "",
    cleaningFee: formData.get("cleaningFee") ?? "",
    weeklyDiscount: formData.get("weeklyDiscount") ?? "",
    monthlyDiscount: formData.get("monthlyDiscount") ?? "",
    maxGuests: formData.get("maxGuests") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const seasons = parseSeasons(v.seasons);
  if (seasons.error) return { error: seasons.error };
  // The field is only on the form once the database has the column (migration 0030).
  const withBeds = formData.get("bedsField") === "1";
  const beds = parseBeds(v.beds);
  if (withBeds && beds.error) return { error: beds.error };
  if ((v.lat == null) !== (v.lng == null)) return { error: "Give both latitude and longitude, or neither." };

  const slug = slugify(v.slug || v.title);
  const supabase = await createClient();
  const { error } = await supabase
    .from("units")
    .update({
      website_published: v.published,
      website_slug: slug || null,
      website_title: v.title || null,
      website_tag: v.tag || null,
      website_type: v.type || null,
      website_area: v.area || null,
      website_building: v.building || null,
      website_description: v.description || null,
      website_highlights: lines(v.highlights),
      website_house_rules: lines(v.houseRules),
      website_amenities: v.amenities,
      website_images: v.images,
      website_lat: v.lat,
      website_lng: v.lng,
      website_maps_url: v.mapsUrl || null,
      website_check_in: v.checkIn,
      website_check_out: v.checkOut,
      website_seasons: seasons.seasons,
      ...(withBeds ? { website_beds: beds.beds } : {}),
      base_nightly_rate_aed: v.nightlyRate,
      weekend_rate_aed: v.weekendRate,
      cleaning_fee_aed: v.cleaningFee ?? 0,
      weekly_discount_pct: v.weeklyDiscount ?? 0,
      monthly_discount_pct: v.monthlyDiscount ?? 0,
      max_guests: v.maxGuests,
    })
    .eq("id", unitId);
  if (error) {
    if (error.message.includes("units_website_ready"))
      return {
        error:
          "To publish, a home needs a web address, title, area, type, at least one photo, a nightly rate, max guests and short-term use. Fill those in or untick Published.",
      };
    if (error.code === "23505") return { error: "Another home already uses that web address." };
    return { error: error.message };
  }
  revalidatePath(`/units/${unitId}`);
  revalidatePath(`/units/${unitId}/website`);
  return { success: v.published ? "Saved. The website shows this home within a minute." : "Saved (not on the website)." };
}
