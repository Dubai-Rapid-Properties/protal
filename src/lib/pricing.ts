/**
 * The price of a direct holiday-home stay from a unit's rates, worked out the
 * way Airbnb does: Friday and Saturday nights at the weekend rate, and a
 * length-of-stay discount (monthly from 28 nights, else weekly from 7) taken
 * off the nights only - never off the cleaning fee.
 */

export interface UnitRates {
  nightly: number;
  /** Friday and Saturday nights; null or 0 means the nightly rate. */
  weekend?: number | null;
  weeklyDiscountPct?: number | null;
  monthlyDiscountPct?: number | null;
}

export interface StayQuote {
  nights: number;
  weekdayNights: number;
  weekendNights: number;
  /** Nights at their rates, before any discount. */
  nightsTotal: number;
  discountPct: number;
  discount: number;
  /** What the nights cost after the discount: the booking's accommodation. */
  accommodation: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The length-of-stay discount a unit gives for this many nights. */
export function stayDiscountPct(nights: number, rates: Pick<UnitRates, "weeklyDiscountPct" | "monthlyDiscountPct">): number {
  if (nights >= 28 && rates.monthlyDiscountPct) return rates.monthlyDiscountPct;
  if (nights >= 7 && rates.weeklyDiscountPct) return rates.weeklyDiscountPct;
  return 0;
}

/**
 * Quotes check-in to check-out (ISO dates, check-out exclusive). `discountPct`
 * overrides the unit's length-of-stay discount when staff agree another.
 */
export function quoteStay(
  checkIn: string,
  checkOut: string,
  rates: UnitRates,
  discountPct?: number
): StayQuote {
  let weekdayNights = 0;
  let weekendNights = 0;
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  for (let t = Date.parse(`${checkIn}T00:00:00Z`); t < end; t += 86_400_000) {
    const day = new Date(t).getUTCDay(); // the night starting on this date
    if (day === 5 || day === 6) weekendNights++;
    else weekdayNights++;
  }
  const nights = weekdayNights + weekendNights;
  const weekend = rates.weekend && rates.weekend > 0 ? rates.weekend : rates.nightly;
  const nightsTotal = round2(weekdayNights * rates.nightly + weekendNights * weekend);
  const pct = Math.min(Math.max(discountPct ?? stayDiscountPct(nights, rates), 0), 99.99);
  const discount = round2((nightsTotal * pct) / 100);
  return {
    nights,
    weekdayNights,
    weekendNights,
    nightsTotal,
    discountPct: pct,
    discount,
    accommodation: round2(nightsTotal - discount),
  };
}

/** An Airbnb stay with the nightly rate its guest paid (accommodation / nights). */
export interface PricedStay {
  checkIn: string;
  checkOut: string;
  nightlyRate: number;
}

export interface AirbnbRate {
  /** Average nightly rate, whole dirhams, weighted by nights. */
  rate: number;
  stays: number;
  from: string;
  to: string;
}

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/**
 * What Airbnb guests paid a night at this unit around `day`: the nights of
 * the (up to) `count` Airbnb stays whose check-in is closest to it. Airbnb
 * does not publish its prices to other software, so the stays recorded from
 * its earnings export are the nearest thing to "the Airbnb rate".
 */
export function airbnbRateNear(stays: PricedStay[], day: string, count = 5): AirbnbRate | null {
  const target = dayNumber(day);
  const nearest = stays
    .filter((s) => s.nightlyRate > 0 && s.checkOut > s.checkIn)
    .map((s) => ({ ...s, nights: dayNumber(s.checkOut) - dayNumber(s.checkIn) }))
    .sort((a, b) => Math.abs(dayNumber(a.checkIn) - target) - Math.abs(dayNumber(b.checkIn) - target))
    .slice(0, count);
  if (nearest.length === 0) return null;
  const nights = nearest.reduce((n, s) => n + s.nights, 0);
  const total = nearest.reduce((n, s) => n + s.nightlyRate * s.nights, 0);
  return {
    rate: Math.round(total / nights),
    stays: nearest.length,
    from: nearest.reduce((m, s) => (s.checkIn < m ? s.checkIn : m), nearest[0].checkIn),
    to: nearest.reduce((m, s) => (s.checkOut > m ? s.checkOut : m), nearest[0].checkOut),
  };
}

/**
 * What a booking form starts the weekend rate and the stay discount from. Typing your own nightly rate
 * means that rate for every night, as agreed with the guest (a direct client's per-day rate): the unit's
 * weekend rate and weekly/monthly discount then stay off until staff type them. Otherwise they follow the
 * unit, except under an Airbnb average, which already mixes weekends and long-stay discounts.
 */
export function formPriceDefaults(opts: {
  ownRate: boolean;
  fromAirbnb: boolean;
  nights: number;
  unit: { weekendRate: number | null; weeklyDiscountPct: number | null; monthlyDiscountPct: number | null } | null;
}): { weekendRate: string; discountPct: number } {
  const { ownRate, fromAirbnb, nights, unit } = opts;
  if (ownRate || fromAirbnb || !unit) return { weekendRate: "", discountPct: 0 };
  return {
    weekendRate: unit.weekendRate ? String(unit.weekendRate) : "",
    discountPct: stayDiscountPct(nights, unit),
  };
}
