/**
 * Reads the month grids of an Airbnb host calendar (Calendar → Month), as the
 * extension collects them (listing-collect.ts, `months`):
 *
 *   { name: "December 2026", days: [["Monday 28 Dec", "28", "Nightly price", "ﺩ.ﺇ900"], ...] }
 *
 * The grid's name gives the month and year, each day's own label ("Monday 28
 * Dec") its date, and the piece with a currency its price. A month whose days'
 * weekdays do not fall on those dates in that year is left out, never guessed.
 */

export interface CalendarDays {
  /** "2026-12-28 ﺩ.ﺇ900": a date and the day's price as shown, for nightFromLabel. */
  labels: string[];
  /** "Dec 2026: 31 days, 27 priced; ..." or why nothing was read, for the note staff see. */
  report: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONEY = /AED|USD|EUR|GBP|SAR|[؀-ۿﹰ-﻿]|⃃|\$|€|£/;

/** "dec", "december", "sept" → 0-11; anything else → -1. */
const monthOf = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, "");
  return w.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(w === "sept" ? "sep" : w)) : -1;
};
const weekdayOf = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, "");
  return w.length >= 3 ? WEEKDAYS.findIndex((d) => d.startsWith(w)) : -1;
};

/** A day's own label: "Monday 28 Dec", "Mon, Dec 28", "Monday, 28 December 2026". */
function dayLabel(piece: string): { weekday: number; day: number; month: number } | null {
  const words = piece.replace(/,/g, " ").trim().split(/\s+/);
  if (words.length < 3 || words.length > 4) return null;
  const weekday = weekdayOf(words[0]);
  const rest = words.slice(1).filter((w) => !/^\d{4}$/.test(w));
  if (weekday < 0 || rest.length !== 2) return null;
  const [a, b] = /^\d{1,2}$/.test(rest[0]) ? rest : [rest[1], rest[0]];
  const month = monthOf(b);
  return /^\d{1,2}$/.test(a) && month >= 0 ? { weekday, day: Number(a), month } : null;
}

export function readCalendarDays(raw: unknown): CalendarDays {
  if (!Array.isArray(raw) || !raw.length) return { labels: [], report: "no month grids on the page" };
  const labels: string[] = [];
  const said: string[] = [];
  for (const grid of raw.slice(0, 24)) {
    if (!grid || typeof grid !== "object") continue;
    const { name, days } = grid as { name?: unknown; days?: unknown };
    const title = typeof name === "string" ? name.trim() : "";
    const m = title.match(/^([a-z]+)\.?\s+(\d{4})$/i);
    const month = m ? monthOf(m[1]) : -1;
    if (!m || month < 0 || !Array.isArray(days)) {
      if (title) said.push(`"${title.slice(0, 20)}": not a month`);
      continue;
    }
    const year = Number(m[2]);
    const short = `${MONTHS[month].slice(0, 1).toUpperCase()}${MONTHS[month].slice(1, 3)} ${year}`;

    const found: string[] = [];
    let dated = 0;
    let wrong: string | null = null;
    for (const day of days.slice(0, 42)) {
      if (!Array.isArray(day)) continue;
      const pieces = day.filter((p): p is string => typeof p === "string");
      const date = pieces.map(dayLabel).find(Boolean);
      if (!date) continue;
      dated++;
      const when = new Date(Date.UTC(year, month, date.day));
      if (date.month !== month || when.getUTCMonth() !== month || when.getUTCDay() !== date.weekday) {
        wrong = pieces.find((p) => dayLabel(p)) ?? "";
        break;
      }
      const price = pieces.find((p) => /\d/.test(p) && MONEY.test(p) && !dayLabel(p));
      if (price) found.push(`${when.toISOString().slice(0, 10)} ${price}`);
    }
    if (wrong !== null) {
      said.push(`${short}: left out ("${wrong.slice(0, 20)}" is not in ${short})`);
      continue;
    }
    if (!dated) {
      said.push(`${short}: no dated days`);
      continue;
    }
    labels.push(...found);
    said.push(`${short}: ${dated} days, ${found.length} priced`);
  }
  return { labels, report: said.join("; ") || "no month grids on the page" };
}
