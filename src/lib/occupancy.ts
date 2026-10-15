import { addDays, coversNight } from "@/lib/calendar";

/**
 * Occupancy of a holiday home over a run of nights: the nights a guest stayed
 * (or will stay), out of the nights it could be let. A night closed for any
 * other reason - the owner's own stay, maintenance, a block, a period closed
 * on Airbnb - could not be let, so it counts for neither.
 *
 * Works night by night, so a stay and a block over the same nights are never
 * counted twice. Dates are ISO `YYYY-MM-DD`; ranges are half-open [start, end).
 */
export interface Occupancy {
  /** Nights with a guest. */
  booked: number;
  /** Nights that could be let: booked plus empty. */
  available: number;
  /** Whole per cent, or null when no night could be let. */
  rate: number | null;
}

export function occupancy(
  from: string,
  to: string,
  stays: { start: string; end: string }[],
  closed: { start: string; end: string }[]
): Occupancy {
  let booked = 0;
  let available = 0;
  for (let night = from; night < to; night = addDays(night, 1)) {
    if (stays.some((s) => coversNight(night, s.start, s.end))) {
      booked++;
      available++;
    } else if (!closed.some((c) => coversNight(night, c.start, c.end))) {
      available++;
    }
  }
  return { booked, available, rate: available ? Math.round((booked / available) * 100) : null };
}

/** Several units' occupancy taken together: their nights added up. */
export function combineOccupancy(parts: Occupancy[]): Occupancy {
  const booked = parts.reduce((n, p) => n + p.booked, 0);
  const available = parts.reduce((n, p) => n + p.available, 0);
  return { booked, available, rate: available ? Math.round((booked / available) * 100) : null };
}
