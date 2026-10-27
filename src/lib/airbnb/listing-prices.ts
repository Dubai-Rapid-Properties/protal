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
import type { ListingPrices } from "@/lib/ical/listings";

export interface AirbnbPrices extends Required<{ [K in keyof ListingPrices]: number | null }> {
  /** "AED", "USD"...; null when the page showed no currency. */
  currency: string | null;
  /** Per-night prices from the calendar, by date (yyyy-mm-dd). */
  nights: { date: string; price: number }[];
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

function fromText(text: string): { values: Partial<Record<Field, number>>; currency: string | null } {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const values: Partial<Record<Field, number>> = {};
  let currency: string | null = null;
  for (let i = 0; i < lines.length; i++) {
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
  return { values, currency };
}

/** "Thursday, October 15, 2026, AED 450, available" → { date, price }. */
export function nightFromLabel(label: string, today: string): { date: string; price: number; currency: string } | null {
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

  const j = (s.prices && typeof s.prices === "object" ? s.prices : {}) as Record<string, unknown>;
  const t = fromText(text);
  const pick = (a: number | null, b: number | undefined) => a ?? b ?? null;

  const currencies = new Set<string>();
  const nights = new Map<string, number>();
  if (Array.isArray(s.nights)) {
    for (const raw of s.nights.slice(0, 500)) {
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
