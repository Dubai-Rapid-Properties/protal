"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { mapAirbnbAmenities, parseAirbnbListing, type AirbnbListing } from "@/lib/airbnb/listing-page";
import { downloadAirbnbPhoto } from "@/lib/airbnb/listing-photos";
import { hasPrices, parseAirbnbPrices, type AirbnbPrices } from "@/lib/airbnb/listing-prices";
import { dubaiToday } from "@/lib/calendar";
import { isAirbnbCalendarUrl } from "@/lib/ical/url";
import { syncUnit } from "@/lib/ical/sync";
import { parseSeasons, seasonsToText } from "@/lib/website-options";
import { storeWebsitePhoto } from "@/lib/website-photos";
import { websiteDefaults } from "../[id]/website/defaults";
import type { WebsiteDefaults } from "../[id]/website/website-form";

const NOT_ALLOWED = "You do not have permission to edit units.";

async function allowed() {
  const profile = await requireProfile();
  return can(profile.role, "units.manage");
}

export type ListingCapture =
  | { error: string }
  | {
      listing: AirbnbListing;
      /** From a host pricing or calendar page; empty elsewhere. */
      prices: AirbnbPrices;
      /** Dubai's date, for the calendar's coming nights. */
      today: string;
      /** Website amenity ids found, and Airbnb names the website has no match for. */
      amenityIds: string[];
      unmatched: string[];
      /** The unit whose Airbnb calendar (or listing name) is this listing. */
      unitId: string | null;
    };

/**
 * Reads what the "Import listing to D|R|P" button (or a paste) sent and finds
 * the unit: the one whose Airbnb calendar address carries the listing's
 * number, else the one with the listing's name. Nothing is saved here.
 */
export async function readAirbnbListing(sent: unknown): Promise<ListingCapture> {
  if (!(await allowed())) return { error: NOT_ALLOWED };
  const listing = parseAirbnbListing(sent);
  const today = dubaiToday();
  const prices = parseAirbnbPrices(sent, today);
  if (!listing.title && !listing.description && !listing.photos.length && !listing.amenities.length && !hasPrices(prices)) {
    return {
      error:
        "Nothing was found on that page. Open the listing (airbnb.com/rooms/…) or its Pricing page on Airbnb and try again.",
    };
  }

  const supabase = await createClient();
  const units = () =>
    supabase.from("units").select("id").eq("is_active", true).in("operating_mode", ["short_term", "both"]).limit(2);
  let unitId: string | null = null;
  if (listing.listingId) {
    const { data } = await units().ilike("airbnb_ical_url", `%/${listing.listingId}.ics%`);
    if (data?.length === 1) unitId = data[0].id;
  }
  if (!unitId && listing.title) {
    const { data } = await units().eq("airbnb_listing_name", listing.title);
    if (data?.length === 1) unitId = data[0].id;
  }

  const { ids, unmatched } = mapAirbnbAmenities(listing.amenities);
  return { listing, prices, today, amenityIds: ids, unmatched, unitId };
}

export type ImportUnit = {
  id: string;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  maxGuests: number | null;
  hasRate: boolean;
};

/** The unit's Website form as it is now, to put the listing into. */
export async function loadUnitWebsite(unitId: string): Promise<{ error: string } | { unit: ImportUnit; defaults: WebsiteDefaults }> {
  if (!(await allowed())) return { error: NOT_ALLOWED };
  if (!z.string().uuid().safeParse(unitId).success) return { error: "Choose the unit." };
  const supabase = await createClient();
  const { data: u } = await supabase.from("units").select("*, properties(name)").eq("id", unitId).maybeSingle();
  if (!u) return { error: "Unit not found." };
  if (!u.is_active || u.operating_mode === "long_term") {
    return { error: "Only active short-term units go on the Holiday Homes website." };
  }
  return {
    unit: {
      id: u.id,
      label: [u.properties?.name, u.unit_number].filter(Boolean).join(" · "),
      bedrooms: u.bedrooms == null ? null : Number(u.bedrooms),
      bathrooms: u.bathrooms == null ? null : Number(u.bathrooms),
      maxGuests: u.max_guests,
      hasRate: Number(u.base_nightly_rate_aed) > 0,
    },
    defaults: websiteDefaults(u),
  };
}

/** Photos copied per call; the page sends a listing's photos a batch at a time. */
const PHOTOS_PER_CALL = 6;

/**
 * Copies listing photos from Airbnb into the portal's photo bucket, so the
 * website never loads Airbnb's copies. Only Airbnb's photo host is fetched.
 */
export async function copyAirbnbPhotos(urls: string[]): Promise<{ url?: string; error?: string }[]> {
  if (!(await allowed())) return [{ error: NOT_ALLOWED }];
  if (!Array.isArray(urls) || urls.length > PHOTOS_PER_CALL) return [{ error: "Too many photos at once." }];
  const supabase = await createClient();
  return Promise.all(
    urls.map(async (url) => {
      if (typeof url !== "string" || url.length > 1000) return { error: "Not an Airbnb photo address." };
      const photo = await downloadAirbnbPhoto(url);
      if ("error" in photo) return photo;
      return storeWebsitePhoto(supabase, photo.bytes, photo.type, photo.name);
    })
  );
}

const factsSchema = z.object({
  bedrooms: z.number().min(0).max(30).multipleOf(0.5).nullable(),
  bathrooms: z.number().min(0).max(30).multipleOf(0.5).nullable(),
  maxGuests: z.number().int().min(1).max(50).nullable(),
});

/** "Use Airbnb's numbers": the unit's bedrooms, bathrooms and max guests. */
export async function applyAirbnbFacts(unitId: string, facts: z.input<typeof factsSchema>): Promise<{ error?: string; success?: string }> {
  if (!(await allowed())) return { error: NOT_ALLOWED };
  const parsed = factsSchema.safeParse(facts);
  if (!z.string().uuid().safeParse(unitId).success || !parsed.success) return { error: "Those numbers could not be used." };
  const f = parsed.data;
  const change = {
    ...(f.bedrooms != null && { bedrooms: f.bedrooms }),
    ...(f.bathrooms != null && { bathrooms: f.bathrooms }),
    ...(f.maxGuests != null && { max_guests: f.maxGuests }),
  };
  if (!Object.keys(change).length) return { error: "Airbnb gave no numbers to use." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("units").update(change).eq("id", unitId).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: NOT_ALLOWED };
  revalidatePath(`/units/${unitId}`);
  return { success: "The unit's bedrooms, bathrooms and guests are updated." };
}

export type UnitPrices = {
  id: string;
  label: string;
  nightly: number | null;
  weekend: number | null;
  cleaning: number | null;
  weeklyDiscount: number | null;
  monthlyDiscount: number | null;
  seasons: string;
};

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** The unit's own rates now, to show next to Airbnb's. */
export async function loadUnitPrices(unitId: string): Promise<{ error: string } | { unit: UnitPrices }> {
  if (!(await allowed())) return { error: NOT_ALLOWED };
  if (!z.string().uuid().safeParse(unitId).success) return { error: "Choose the unit." };
  const supabase = await createClient();
  const { data: u } = await supabase
    .from("units")
    .select(
      "id, unit_number, is_active, operating_mode, base_nightly_rate_aed, weekend_rate_aed, cleaning_fee_aed, weekly_discount_pct, monthly_discount_pct, website_seasons, properties(name)"
    )
    .eq("id", unitId)
    .maybeSingle();
  if (!u) return { error: "Unit not found." };
  if (!u.is_active || u.operating_mode === "long_term") return { error: "Only active short-term units take nightly rates." };
  return {
    unit: {
      id: u.id,
      label: [u.properties?.name, u.unit_number].filter(Boolean).join(" · "),
      nightly: num(u.base_nightly_rate_aed),
      weekend: num(u.weekend_rate_aed),
      cleaning: num(u.cleaning_fee_aed),
      weeklyDiscount: num(u.weekly_discount_pct),
      monthlyDiscount: num(u.monthly_discount_pct),
      seasons: seasonsToText(u.website_seasons),
    },
  };
}

export type PricesState = { error?: string; success?: string };

const amount = z.union([z.literal("").transform(() => null), z.coerce.number().min(0).max(1_000_000)]);
const pct = z.union([
  z.literal("").transform(() => null),
  z.coerce.number().min(0, "Discounts are 0 to 99 %").lt(100, "Discounts are 0 to 99 %"),
]);
const pricesSchema = z.object({
  nightly: amount,
  weekend: amount,
  cleaning: amount,
  weeklyDiscount: pct,
  monthlyDiscount: pct,
  replaceSeasons: z.boolean(),
  seasons: z.string().max(5000),
});

/**
 * Saves the rates staff confirmed onto the unit (migration 0020 columns), and
 * the website's seasonal rates when they ticked that. Amounts are AED: the
 * page refuses other currencies before this is reached.
 */
export async function saveAirbnbPrices(unitId: string, _prev: PricesState, formData: FormData): Promise<PricesState> {
  if (!(await allowed())) return { error: NOT_ALLOWED };
  if (!z.string().uuid().safeParse(unitId).success) return { error: "Choose the unit." };
  const parsed = pricesSchema.safeParse({
    nightly: formData.get("nightly") ?? "",
    weekend: formData.get("weekend") ?? "",
    cleaning: formData.get("cleaning") ?? "",
    weeklyDiscount: formData.get("weeklyDiscount") ?? "",
    monthlyDiscount: formData.get("monthlyDiscount") ?? "",
    replaceSeasons: formData.get("replaceSeasons") === "on",
    seasons: formData.get("seasons") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the prices." };
  const v = parsed.data;
  const seasons = v.replaceSeasons ? parseSeasons(v.seasons) : null;
  if (seasons?.error) return { error: seasons.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .update({
      base_nightly_rate_aed: v.nightly,
      weekend_rate_aed: v.weekend,
      cleaning_fee_aed: v.cleaning,
      weekly_discount_pct: v.weeklyDiscount,
      monthly_discount_pct: v.monthlyDiscount,
      ...(seasons && { website_seasons: seasons.seasons }),
    })
    .eq("id", unitId)
    .select("id");
  if (error) {
    if (error.message.includes("units_website_ready"))
      return { error: "This home is on the website, so it needs a nightly rate above 0." };
    return { error: error.message };
  }
  if (!data?.length) return { error: NOT_ALLOWED };
  revalidatePath(`/units/${unitId}`);
  return { success: "Prices saved. The website uses them within a minute." };
}

const newUnitSchema = z.object({
  building: z.string().trim().min(2, "Enter the building's name.").max(120),
  unitNumber: z.string().trim().min(1, "Enter the apartment number.").max(30),
  calendarLink: z.union([z.literal(""), z.string().trim().max(1000)]),
  bedrooms: z.number().min(0).max(20).nullable(),
  bathrooms: z.number().min(0).max(20).nullable(),
  guests: z.number().int().min(1).max(50).nullable(),
  title: z.string().max(300).nullable(),
});

/**
 * "New unit from this listing": a short-term unit for an Airbnb listing not
 * in the portal yet. Its building is found by name (or added), its rooms and
 * guests come from the listing, and with the listing's Airbnb calendar link
 * its reservations are imported at once and every 15 minutes after. Owner and
 * DET permit are added on the unit afterwards.
 */
export async function createUnitFromListing(
  input: z.input<typeof newUnitSchema>
): Promise<{ error: string } | { unitId: string; message: string }> {
  const profile = await requireProfile();
  if (!can(profile.role, "units.manage")) return { error: "You do not have permission to add units." };
  const parsed = newUnitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the new unit's details." };
  const v = parsed.data;
  if (v.calendarLink && !isAirbnbCalendarUrl(v.calendarLink)) {
    return { error: "The calendar link must be the listing's Airbnb calendar export (https://www.airbnb…/calendar/ical/….ics)." };
  }

  const supabase = await createClient();
  const name = v.building.replace(/\s+/g, " ");
  const { data: buildings } = await supabase.from("properties").select("id, name").eq("is_active", true);
  let propertyId = (buildings ?? []).find((p) => p.name.trim().toLowerCase() === name.toLowerCase())?.id;
  if (!propertyId) {
    if (!can(profile.role, "properties.manage")) return { error: `There is no building "${name}" and you cannot add buildings.` };
    const { data, error } = await supabase.from("properties").insert({ name, kind: "building" }).select("id").single();
    if (error) return { error: `Could not add the building: ${error.message}` };
    propertyId = data.id;
  }

  const { data: existing } = await supabase
    .from("units")
    .select("id")
    .eq("property_id", propertyId)
    .eq("unit_number", v.unitNumber)
    .maybeSingle();
  if (existing) return { error: `${name} ${v.unitNumber} is already in the portal: choose it in the list instead.` };

  const beds = v.bedrooms ?? 1;
  const { data: unit, error } = await supabase
    .from("units")
    .insert({
      property_id: propertyId,
      unit_number: v.unitNumber,
      kind: beds === 0 ? "studio" : /penthouse/i.test(v.title ?? "") ? "penthouse" : /villa/i.test(v.title ?? "") ? "villa" : "apartment",
      bedrooms: beds,
      bathrooms: v.bathrooms ?? 1,
      max_guests: v.guests,
      furnishing: "fully_furnished",
      operating_mode: "short_term",
      airbnb_ical_url: v.calendarLink || null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  let message = `${name} ${v.unitNumber} added.`;
  if (v.calendarLink) {
    const sync = await syncUnit(supabase, unit.id, v.calendarLink);
    const stays = sync.created ?? 0;
    message += sync.ok || stays
      ? ` ${stays} Airbnb ${stays === 1 ? "stay" : "stays"} imported.`
      : " The first calendar sync failed; it retries every 15 minutes.";
  }
  revalidatePath("/units");
  return { unitId: unit.id, message };
}
