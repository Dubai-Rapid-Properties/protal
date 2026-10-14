/**
 * Date arithmetic for the booking calendars.
 *
 * Everything works on ISO `YYYY-MM-DD` strings and UTC midnights, so a server
 * in UTC and a browser in Dubai agree on which day a stay starts. Stays are
 * half-open, exactly like the database's exclusion constraint: a stay from the
 * 10th to the 15th occupies the nights of the 10th-14th, and the 15th is free
 * for the next guest to check in.
 */

const DAY_MS = 86_400_000;
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000; // UTC+4, no daylight saving

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function addDays(iso: string, days: number): string {
  return isoDate(new Date(utc(iso).getTime() + days * DAY_MS));
}

/** Nights between two dates (check-out minus check-in). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((utc(checkOut).getTime() - utc(checkIn).getTime()) / DAY_MS);
}

/** Today's date in Dubai, whatever the server's own timezone. */
export function dubaiToday(now = new Date()): string {
  return isoDate(new Date(now.getTime() + DUBAI_OFFSET_MS));
}

/** `YYYY-MM` from a query parameter, falling back to the current Dubai month. */
export function parseMonth(value: string | null | undefined, now = new Date()): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    const year = Number(value.slice(0, 4));
    if (year >= 2000 && year <= 2100) return value;
  }
  return dubaiToday(now).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return isoDate(d).slice(0, 7);
}

/** First and last day of a `YYYY-MM` month. */
export function monthRange(month: string): { start: string; end: string } {
  const start = `${month}-01`;
  const end = addDays(`${shiftMonth(month, 1)}-01`, -1);
  return { start, end };
}

/**
 * The weeks shown for a month, Monday first, padded with the neighbouring
 * months' days so every row has seven cells.
 */
export function monthGrid(month: string): string[][] {
  const { start, end } = monthRange(month);
  const weekday = (utc(start).getUTCDay() + 6) % 7; // Monday = 0
  let cursor = addDays(start, -weekday);
  const weeks: string[][] = [];
  while (cursor <= end || weeks.length === 0) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** How many months a calendar can show at once. */
export const MONTH_SPANS = [1, 3, 6, 12] as const;
export type MonthSpan = (typeof MONTH_SPANS)[number];

/** A month span from a query parameter, falling back to `fallback`. */
export function parseMonthSpan(value: string | null | undefined, fallback: MonthSpan = 1): MonthSpan {
  const n = Number(value);
  return (MONTH_SPANS as readonly number[]).includes(n) ? (n as MonthSpan) : fallback;
}

/**
 * The days a run of `span` month grids starting at `month` covers, as a
 * half-open [start, end) range - what to fetch stays and blocks for.
 */
export function monthSpanRange(month: string, span: number): { start: string; end: string } {
  const last = monthGrid(shiftMonth(month, span - 1));
  return { start: monthGrid(month)[0][0], end: addDays(last.at(-1)!.at(-1)!, 1) };
}

/**
 * D|R|P takes bookings up to a year ahead, and Airbnb closes everything past
 * its own booking window with a "not available" period. An Airbnb block that
 * starts on or after this date is that window edge, not a real block, and is
 * not shown.
 */
export function bookingHorizon(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  // 29 Feb + 1 year -> 1 Mar, like the database's interval arithmetic.
  return isoDate(new Date(Date.UTC(y + 1, m - 1, d)));
}

/** A PostgREST filter: every block except Airbnb's past the booking horizon. */
export function withinHorizonFilter(today: string): string {
  return `reason.neq.channel_sync,start_date.lt.${bookingHorizon(today)}`;
}

/** Does a half-open [start, end) range cover the night of `day`? */
export function coversNight(day: string, start: string, end: string): boolean {
  return start <= day && day < end;
}

/** Do two half-open date ranges overlap? */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Nights of a stay that fall inside [from, to] inclusive. */
export function nightsWithin(checkIn: string, checkOut: string, from: string, to: string): number {
  const start = checkIn > from ? checkIn : from;
  const endExclusive = checkOut < addDays(to, 1) ? checkOut : addDays(to, 1);
  return Math.max(0, nightsBetween(start, endExclusive));
}

/**
 * The parts of [start, end) not covered by any of `ranges` (all half-open).
 * Used for an Airbnb block that holds several direct stays: what is left to
 * book.
 */
export function uncoveredRanges(
  start: string,
  end: string,
  ranges: { start: string; end: string }[]
): { start: string; end: string }[] {
  const gaps: { start: string; end: string }[] = [];
  let cursor = start;
  for (const r of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    if (r.end <= cursor || r.start >= end) continue;
    if (r.start > cursor) gaps.push({ start: cursor, end: r.start });
    if (r.end > cursor) cursor = r.end;
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  return gaps;
}
