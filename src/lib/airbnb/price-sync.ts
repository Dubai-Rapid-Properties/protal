/**
 * The extension's automatic price sync: what a reading of an Airbnb host page
 * (Pricing or Calendar, see listing-prices.ts) changes on the unit, with no
 * one to check it first. So it is stricter than the import page: only AED,
 * only values the page showed (a missing one never clears the unit's), and
 * calendar nights only replace the website's seasons for the dates they cover.
 */
import { hasPrices, type AirbnbPrices } from "@/lib/airbnb/listing-prices";

export type Season = { name: string; from: string; to: string; rate: number };

export interface UnitRates {
  nightly: number | null;
  weekend: number | null;
  cleaning: number | null;
  weeklyDiscount: number | null;
  monthlyDiscount: number | null;
  seasons: Season[];
}

export type RateField = Exclude<keyof UnitRates, "seasons">;

/** The unit's columns (migration 0020) for each rate. */
export const RATE_COLUMNS = {
  nightly: "base_nightly_rate_aed",
  weekend: "weekend_rate_aed",
  cleaning: "cleaning_fee_aed",
  weeklyDiscount: "weekly_discount_pct",
  monthlyDiscount: "monthly_discount_pct",
} as const satisfies Record<RateField, string>;

const LABELS: Record<RateField, string> = {
  nightly: "Nightly",
  weekend: "Weekend",
  cleaning: "Cleaning",
  weeklyDiscount: "Weekly discount",
  monthlyDiscount: "Monthly discount",
};

export type SyncPlan =
  | { skip: string }
  | {
      rates: Partial<Record<RateField, number>>;
      /** The website's seasons after the change; absent when they stay as they are. */
      seasons?: Season[];
      /** One line per change, for the note on Airbnb ("Nightly AED 450 → 480"). */
      changes: string[];
    };

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
/** Friday and Saturday nights take the website's weekend rate (see the website's nightRate). */
const isWeekend = (d: string) => [5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

/**
 * The calendar nights merged into the unit's seasons: rows inside the nights'
 * date span give way to what the calendar shows there; rows outside it stay.
 * A night at the rate the website would charge anyway (the weekend rate on
 * Friday and Saturday, else the nightly rate) needs no row.
 */
export function mergeCalendarSeasons(
  existing: Season[],
  nights: { date: string; price: number }[],
  nightly: number | null,
  weekend: number | null,
  today: string
): Season[] {
  const until = addDays(today, 365);
  const seen = nights.filter((n) => n.date >= today && n.date <= until).sort((a, b) => a.date.localeCompare(b.date));
  if (!seen.length) return existing;
  const first = seen[0].date;
  const last = seen[seen.length - 1].date;

  const kept: Season[] = [];
  for (const s of existing) {
    if (s.to < first || s.from > last) kept.push(s);
    else {
      if (s.from < first) kept.push({ ...s, to: addDays(first, -1) });
      if (s.to > last) kept.push({ ...s, from: addDays(last, 1) });
    }
  }

  const rows: Season[] = [];
  for (const n of seen) {
    const usual = (isWeekend(n.date) ? weekend : null) ?? nightly;
    if (n.price === usual) continue;
    const prev = rows.at(-1);
    if (prev && prev.rate === n.price && addDays(prev.to, 1) === n.date) prev.to = n.date;
    else rows.push({ name: "Airbnb", from: n.date, to: n.date, rate: n.price });
  }
  return [...kept, ...rows].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A unit's stored seasons (website_seasons), well-formed rows only, in date order. */
export function storedSeasons(raw: unknown): Season[] {
  if (!Array.isArray(raw)) return [];
  const out: Season[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { name, from, to, rate } = r as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string" || !ISO.test(from) || !ISO.test(to) || to < from) continue;
    if (!(Number(rate) > 0)) continue;
    out.push({ name: typeof name === "string" ? name : "", from, to, rate: Number(rate) });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

const show = (field: RateField, v: number | null) =>
  v == null ? "none" : field.endsWith("Discount") ? `${v}%` : `AED ${v}`;

/** `unit.seasons` as storedSeasons gives them. */
export function planPriceSync(prices: AirbnbPrices, unit: UnitRates, today: string): SyncPlan {
  if (!hasPrices(prices)) return { skip: "No prices on this page." };
  if (prices.currency !== "AED") {
    return {
      skip: !prices.currency
        ? "No currency on this page, so nothing was saved."
        : `This page shows prices in ${prices.currency === "mixed" ? "several currencies" : prices.currency}; the portal keeps AED, so nothing was saved.`,
    };
  }

  const rates: Partial<Record<RateField, number>> = {};
  const changes: string[] = [];
  for (const field of Object.keys(RATE_COLUMNS) as RateField[]) {
    const v = prices[field];
    // A nightly rate of 0 would take a published home off the website.
    if (v == null || (field === "nightly" && v <= 0) || v === unit[field]) continue;
    rates[field] = v;
    changes.push(`${LABELS[field]} ${show(field, unit[field])} → ${show(field, v)}`);
  }

  const seasons = mergeCalendarSeasons(
    unit.seasons,
    prices.nights,
    rates.nightly ?? unit.nightly,
    rates.weekend ?? unit.weekend,
    today
  );
  const seasonsChanged = JSON.stringify(seasons) !== JSON.stringify(unit.seasons);
  if (seasonsChanged) changes.push(`Calendar prices: ${seasons.length} seasonal rate${seasons.length === 1 ? "" : "s"} on the website`);
  return { rates, ...(seasonsChanged && { seasons }), changes };
}
