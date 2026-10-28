/**
 * Reads a listing's prices from Airbnb's host pages, as the "Import listing to
 * D|R|P" button sends them (see listing-collect.ts) or as staff paste them:
 * the pricing settings (Listings → the listing → Pricing) and, where the page
 * labels its days, the host calendar's per-night prices.
 *
 * Each reading is of the page as it is: Airbnb is never asked by the portal.
 * On the import page staff confirm each value before saving; the extension's
 * automatic sync saves them under stricter rules (see price-sync.ts). Every
 * value may be missing.
 */
import { amountIn, parseDateText } from "@/lib/airbnb/reservation-page";
import { readCalendarDays } from "@/lib/airbnb/calendar-days";
import type { ListingPrices } from "@/lib/ical/listings";

export interface AirbnbPrices extends Required<{ [K in keyof ListingPrices]: number | null }> {
  /** "AED", "USD"...; null when the page showed no currency. */
  currency: string | null;
  /** Per-night prices from the calendar, by date (yyyy-mm-dd). */
  nights: { date: string; price: number }[];
  /** What the calendar's month grids gave ("Dec 2026: 31 days, 27 priced"), when the page had them. */
  calendar?: string;
}

export const NO_PRICES: AirbnbPrices = {
  currency: null,
  nightly: null,
  weekend: null,
  cleaning: null,
  weeklyDiscount: null,
  monthlyDiscount: null,
  nights: [],
};

const SYMBOLS: [RegExp, string][] = [
  [/\bAED\b|د\.إ/, "AED"],
  [/\bUSD\b|US\$|\$/, "USD"],
  [/\bEUR\b|€/, "EUR"],
  [/\bGBP\b|£/, "GBP"],
  [/\bSAR\b/, "SAR"],
  [/\b(INR|CAD|AUD|CHF|QAR|OMR|KWD|BHD|EGP|TRY)\b|₹/, "other"],
];

export function currencyOf(text: string): string | null {
  for (const [re, code] of SYMBOLS) {
    const m = text.match(re);
    if (m) return code === "other" ? (m[1] ?? "INR") : code;
  }
  return null;
}

/** Airbnb's own host pages (pricing, calendar, listing editor). */
export function isHostPage(url: string | null): boolean {
  return /airbnb\.[a-z.]+\/(hosting|multicalendar|manage-your-space)\b/i.test(url ?? "");
}

const money = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? amountIn(v) ?? NaN : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null;
};

/** A price factor (0.9) or a percentage (10) as the percent off. */
const discount = (v: unknown, isFactor: boolean): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const pct = isFactor ? (n > 0 && n <= 1 ? (1 - n) * 100 : NaN) : n;
  return pct >= 0 && pct < 100 ? Math.round(pct * 100) / 100 : null;
};

type Field = Exclude<keyof AirbnbPrices, "currency" | "nights">;

/** Labels on the pricing page; the value is on the label's line or just below. */
const LABELS: { field: Field; label: RegExp; not?: RegExp; percent?: boolean }[] = [
  { field: "nightly", label: /^(nightly|base|weekday|per night) price\b|^price per night\b|^base price\b/i },
  { field: "weekend", label: /^(custom )?weekend (nightly )?price\b/i },
  { field: "cleaning", label: /^cleaning fee\b/i, not: /short.?stay/i },
  { field: "weeklyDiscount", label: /^weekly( discount)?\b/i, percent: true },
  { field: "monthlyDiscount", label: /^monthly( discount)?\b/i, percent: true },
];

/** The calendar's side panel puts the value first: "229 د.إ per night", "2% weekly discount". */
const VALUE_FIRST: { field: Field; re: RegExp; percent?: boolean }[] = [
  { field: "nightly", re: /^(.*\d.*?)\s*(?:per night|\/\s*night|nightly price|base price)$/i },
  { field: "weekend", re: /^(.*\d.*?)\s*weekend (?:nightly )?price$/i },
  { field: "weeklyDiscount", re: /^(\d{1,2}(?:\.\d+)?)\s*%\s*weekly(?: discount)?$/i, percent: true },
  { field: "monthlyDiscount", re: /^(\d{1,2}(?:\.\d+)?)\s*%\s*monthly(?: discount)?$/i, percent: true },
];

/** Right-to-left marks Arabic amounts come wrapped in ("229 د.إ"). */
const BIDI = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;

/**
 * The ways a page can write dirhams: "د.إ" in plain or presentation-form
 * letters, with any of the dots Arabic uses (or none), in either order, and the
 * new dirham sign (U+20C3).
 */
const DIRHAM =
  /[\u062F\uFEA9\uFEAA]\s*[.\u066B\u06D4\u2024\u00B7]?\s*[\u0625\u0627\uFE87\uFE88\uFE8D\uFE8E]\.?|[\u0625\u0627\uFE87\uFE88\uFE8D\uFE8E]\s*[.\u066B\u06D4\u2024\u00B7]?\s*[\u062F\uFEA9\uFEAA]|\u20C3/g;

/** Text with right-to-left marks gone and dirhams written "AED": "386د.إ" → "386 AED ". */
export const plainMoney = (text: string) => text.replace(BIDI, "").replace(DIRHAM, " AED ");

/**
 * `calendar`: on the host calendar every day carries a "Nightly price" label of its own, so only
 * the side panel's lines ("229 د.إ per night") are read there.
 */
function fromText(text: string, calendar = false): { values: Partial<Record<Field, number>>; currency: string | null } {
  const lines = plainMoney(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const values: Partial<Record<Field, number>> = {};
  let currency: string | null = null;
  for (let i = 0; i < lines.length && !calendar; i++) {
    for (const { field, label, not, percent } of LABELS) {
      if (values[field] !== undefined || !label.test(lines[i]) || not?.test(lines[i])) continue;
      // The label's own line (after the label), then the next three.
      // Stops at the next label, so an unset value never takes its neighbour's.
      const below = lines.slice(i + 1, i + 4);
      const stop = below.findIndex((l) => LABELS.some((x) => x.label.test(l)));
      const near = [lines[i].replace(label, ""), ...(stop >= 0 ? below.slice(0, stop) : below)];
      for (const line of near) {
        if (percent) {
          const m = line.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
          if (m) {
            values[field] = Number(m[1]);
            break;
          }
        } else if (/\d/.test(line) && currencyOf(line) && !/%/.test(line)) {
          const n = money(line, 1_000_000);
          if (n != null) {
            values[field] = n;
            currency ??= currencyOf(line);
            break;
          }
        }
      }
    }
  }
  // Then the side panel's lines, for what the labels did not give.
  for (const line of lines) {
    for (const { field, re, percent } of VALUE_FIRST) {
      const m = values[field] === undefined ? line.match(re) : null;
      if (!m) continue;
      if (percent) values[field] = Number(m[1]);
      else {
        // "per night" and "weekend price" say what the amount is, with or without a currency.
        const n = money(m[1], 1_000_000);
        if (n != null) {
          values[field] = n;
          currency ??= currencyOf(m[1]);
        }
      }
    }
  }
  // An amount the page shows without a currency is in the one its currency button shows ("AED").
  currency ??= lines.map((l) => l.match(/^(AED|USD|EUR|GBP|SAR)$/)?.[1]).find(Boolean) ?? null;
  return { values, currency };
}

/** "Thursday, October 15, 2026, AED 450, available" → { date, price }. */
export function nightFromLabel(raw: string, today: string): { date: string; price: number; currency: string } | null {
  const label = plainMoney(raw);
  const currency = currencyOf(label);
  const date = parseDateText(label, today);
  if (!currency || !date) return null;
  // amountIn takes the amount next to the currency, not the day or the year.
  const price = amountIn(label);
  return price != null && price > 0 && price < 1_000_000 ? { date, price, currency } : null;
}

/**
 * The prices on a host page. Pages a guest sees (the listing itself) show
 * prices with Airbnb's fees for chosen dates, so only host pages, or pasted
 * text with the pricing page's labels, are read.
 */
export function parseAirbnbPrices(sent: unknown, today: string): AirbnbPrices {
  const s = (sent && typeof sent === "object" ? sent : {}) as Record<string, unknown>;
  const url = typeof s.u === "string" ? s.u : null;
  const text = typeof s.text === "string" ? s.text.slice(0, 100_000) : "";
  if (!isHostPage(url) && !/\b(nightly|base|weekend) price\b/i.test(text)) return { ...NO_PRICES, nights: [] };

  // The calendar (Calendar, multicalendar) keeps every listing's settings and days in the page, so
  // there only what it shows for the listing being looked at counts: the side panel's text and the
  // month grid on screen.
  const calendar = /\/(multicalendar|hosting\/calendar)\b/i.test(url ?? "");
  const j = (!calendar && s.prices && typeof s.prices === "object" ? s.prices : {}) as Record<string, unknown>;
  const t = fromText(text, calendar);
  const pick = (a: number | null, b: number | undefined) => a ?? b ?? null;

  const currencies = new Set<string>();
  const nights = new Map<string, number>();
  // The month grids (extension 1.7+), then, on one listing's own pages, the labelled days.
  const grids = Array.isArray(s.months) ? readCalendarDays(s.months) : null;
  const labels = [...(grids?.labels ?? []), ...(!calendar && Array.isArray(s.nights) ? s.nights : [])];
  {
    for (const raw of labels.slice(0, 500)) {
      if (typeof raw !== "string") continue;
      const n = nightFromLabel(raw.slice(0, 300), today);
      if (n && !nights.has(n.date)) {
        nights.set(n.date, n.price);
        currencies.add(n.currency);
      }
    }
  }

  const jsonCurrency = typeof j.currency === "string" && /^[A-Z]{3}$/.test(j.currency) ? j.currency : null;
  const currency = jsonCurrency ?? t.currency ?? (currencies.size === 1 ? [...currencies][0] : null);
  return {
    currency: currencies.size > 1 ? "mixed" : currency,
    nightly: pick(money(j.nightly, 1_000_000), t.values.nightly),
    weekend: pick(money(j.weekend, 1_000_000), t.values.weekend),
    cleaning: pick(money(j.cleaning, 1_000_000), t.values.cleaning),
    weeklyDiscount: pick(discount(j.weeklyFactor, true), t.values.weeklyDiscount),
    monthlyDiscount: pick(discount(j.monthlyFactor, true), t.values.monthlyDiscount),
    nights: [...nights].map(([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date)),
    ...(grids && { calendar: grids.report }),
  };
}

export const hasPrices = (p: AirbnbPrices) =>
  p.nightly != null || p.weekend != null || p.cleaning != null || p.weeklyDiscount != null || p.monthlyDiscount != null || p.nights.length > 0;

const nextDay = (d: string) => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);

/**
 * Calendar nights as website seasons: from today for a year, nights at the
 * base nightly rate left out, and consecutive nights at one price merged into
 * one row (from and to are both nights of the stay).
 */
export function seasonsFromNights(
  nights: { date: string; price: number }[],
  base: number | null,
  today: string
): { name: string; from: string; to: string; rate: number }[] {
  const until = new Date(Date.parse(today) + 365 * 86_400_000).toISOString().slice(0, 10);
  const rows: { name: string; from: string; to: string; rate: number }[] = [];
  for (const n of [...nights].sort((a, b) => a.date.localeCompare(b.date))) {
    if (n.date < today || n.date > until || n.price === base) continue;
    const last = rows.at(-1);
    if (last && last.rate === n.price && nextDay(last.to) === n.date) last.to = n.date;
    else rows.push({ name: "Airbnb", from: n.date, to: n.date, rate: n.price });
  }
  return rows;
}
