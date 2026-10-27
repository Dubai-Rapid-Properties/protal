import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { parseAirbnbListing } from "@/lib/airbnb/listing-page";
import { parseAirbnbPrices } from "@/lib/airbnb/listing-prices";
import { planPriceSync, RATE_COLUMNS, storedSeasons, type RateField } from "@/lib/airbnb/price-sync";
import { dubaiToday } from "@/lib/calendar";
import type { TablesUpdate } from "@/lib/db/database.types";

/**
 * POST /units/from-airbnb/sync - the "D|R|P for Airbnb" extension's automatic
 * price sync. Whenever staff have a listing's Pricing or Calendar page open on
 * Airbnb, the extension sends what the page shows (the same reading as the
 * Import button) and the unit whose Airbnb calendar is that listing takes the
 * new rates at once, so the Holiday Homes website follows Airbnb.
 *
 * It runs as the signed-in staff member (their portal session cookie), so RLS
 * and the units.manage capability apply as on the import page. Only the
 * extension calls it: a JSON body and an extension (or this portal's) origin.
 */
const MAX_BODY = 500_000;

export type SyncAnswer =
  | { status: "saved"; unit: string; changes: string[]; nights: number }
  | { status: "unchanged"; unit: string; nights: number }
  | { status: "skipped" | "signin" | "error"; message: string };

const answer = (body: SyncAnswer, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function fromExtension(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (/^(chrome|moz|safari-web)-extension:\/\//.test(origin)) return true;
  return origin === new URL(request.url).origin;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** The page's nightly price line, any character beyond plain English spelled out ("229 [U+062F] per night"). */
function priceLineOf(sent: unknown): string {
  const text = sent && typeof sent === "object" ? (sent as { text?: unknown }).text : null;
  if (typeof text !== "string") return "";
  const line = text.split("\n").find((l) => /\d/.test(l) && /night|price/i.test(l));
  return line
    ? `"${line
        .trim()
        .slice(0, 60)
        .replace(/[^\x20-\x7e]/g, (c) => `[U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`)}"`
    : "";
}

export async function POST(request: Request) {
  if (!fromExtension(request) || !request.headers.get("content-type")?.startsWith("application/json")) {
    return answer({ status: "error", message: "Only the D|R|P extension can send prices here." }, 403);
  }
  let profile;
  try {
    profile = await getProfile();
  } catch {
    return answer({ status: "error", message: "The portal did not answer. Prices will be sent again shortly." }, 503);
  }
  if (!profile) return answer({ status: "signin", message: "Sign in to the D|R|P portal in this browser to sync prices." }, 401);
  if (!can(profile.role, "units.manage")) {
    return answer({ status: "skipped", message: "Your portal account cannot change unit prices." }, 403);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return answer({ status: "error", message: "The page sent too much." }, 413);
  let sent: unknown;
  try {
    sent = JSON.parse(raw);
  } catch {
    return answer({ status: "error", message: "The page could not be read." }, 400);
  }

  const today = dubaiToday();
  const { listingId } = parseAirbnbListing(sent);
  if (!listingId) return answer({ status: "skipped", message: "Open one listing's Pricing or Calendar page." });

  const supabase = await createClient();
  const { data: units, error: findError } = await supabase
    .from("units")
    .select(
      "id, unit_number, base_nightly_rate_aed, weekend_rate_aed, cleaning_fee_aed, weekly_discount_pct, monthly_discount_pct, website_seasons, properties(name)"
    )
    .eq("is_active", true)
    .in("operating_mode", ["short_term", "both"])
    .ilike("airbnb_ical_url", `%/${listingId}.ics%`)
    .limit(2);
  if (findError) return answer({ status: "error", message: findError.message }, 500);
  if (!units?.length) {
    return answer({
      status: "skipped",
      message: `No unit has Airbnb listing ${listingId} as its calendar. Add the listing's calendar to the unit in the portal.`,
    });
  }
  if (units.length > 1) {
    return answer({ status: "skipped", message: `More than one unit uses Airbnb listing ${listingId}; prices were not saved.` });
  }
  const u = units[0];
  const label = [u.properties?.name, u.unit_number].filter(Boolean).join(" · ");

  const prices = parseAirbnbPrices(sent, today);
  const plan = planPriceSync(
    prices,
    {
      nightly: num(u.base_nightly_rate_aed),
      weekend: num(u.weekend_rate_aed),
      cleaning: num(u.cleaning_fee_aed),
      weeklyDiscount: num(u.weekly_discount_pct),
      monthlyDiscount: num(u.monthly_discount_pct),
      seasons: storedSeasons(u.website_seasons),
    },
    today
  );
  if ("skip" in plan) {
    // Say what the page showed, so a currency written some new way can be added.
    const sample = prices.currency ? "" : priceLineOf(sent);
    return answer({ status: "skipped", message: plan.skip + (sample ? ` The page showed: ${sample}` : "") });
  }
  // How many calendar days were read, so staff can see their per-night prices arrive.
  const nights = prices.nights.length;
  if (!plan.changes.length) return answer({ status: "unchanged", unit: label, nights });

  const change: TablesUpdate<"units"> = {};
  for (const [field, value] of Object.entries(plan.rates)) change[RATE_COLUMNS[field as RateField]] = value;
  if (plan.seasons) change.website_seasons = plan.seasons;

  const { data, error } = await supabase.from("units").update(change).eq("id", u.id).select("id");
  if (error) return answer({ status: "error", message: error.message }, 500);
  if (!data?.length) return answer({ status: "skipped", message: "Your portal account cannot change this unit." }, 403);
  console.info(`[airbnb-sync] ${profile.id} updated ${label} (listing ${listingId}): ${plan.changes.join("; ")}`);
  revalidatePath(`/units/${u.id}`);
  return answer({ status: "saved", unit: label, changes: plan.changes, nights });
}
