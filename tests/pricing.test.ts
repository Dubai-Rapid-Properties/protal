import { test } from "node:test";
import assert from "node:assert/strict";
import { airbnbRateNear, formPriceDefaults, quoteStay, stayDiscountPct } from "@/lib/pricing";

// 2026-10-05 is a Monday.
const rates = { nightly: 340, weekend: 347, weeklyDiscountPct: 5, monthlyDiscountPct: 15 };

test("Friday and Saturday nights are charged at the weekend rate", () => {
  // Thu 8 Oct -> Sun 11 Oct: nights of Thu, Fri, Sat.
  const q = quoteStay("2026-10-08", "2026-10-11", rates);
  assert.deepEqual([q.nights, q.weekdayNights, q.weekendNights], [3, 1, 2]);
  assert.equal(q.nightsTotal, 340 + 347 * 2);
  assert.equal(q.discountPct, 0);
  assert.equal(q.accommodation, 1034);
});

test("no weekend rate means every night at the nightly rate", () => {
  const q = quoteStay("2026-10-08", "2026-10-11", { nightly: 340 });
  assert.equal(q.accommodation, 1020);
});

test("7 nights earn the weekly discount, 28 the monthly one, on the nights only", () => {
  const week = quoteStay("2026-10-05", "2026-10-12", rates);
  assert.equal(week.nights, 7);
  assert.equal(week.nightsTotal, 5 * 340 + 2 * 347);
  assert.equal(week.discountPct, 5);
  assert.equal(week.accommodation, Math.round((2394 - 119.7) * 100) / 100);

  const month = quoteStay("2026-10-05", "2026-11-02", rates);
  assert.equal(month.nights, 28);
  assert.equal(month.discountPct, 15);

  assert.equal(stayDiscountPct(6, rates), 0);
  assert.equal(stayDiscountPct(27, rates), 5);
  assert.equal(stayDiscountPct(30, { weeklyDiscountPct: 5 }), 5, "no monthly discount falls back to weekly");
});

test("a discount agreed by staff replaces the unit's", () => {
  assert.equal(quoteStay("2026-10-05", "2026-10-07", rates, 10).discount, 68);
  assert.equal(quoteStay("2026-10-05", "2026-10-12", rates, 0).discount, 0);
});

test("airbnbRateNear averages the Airbnb stays closest to the dates, by night", () => {
  const stays = [
    { checkIn: "2026-01-02", checkOut: "2026-01-05", nightlyRate: 900 }, // far away
    { checkIn: "2026-09-20", checkOut: "2026-09-22", nightlyRate: 400 }, // 2 nights
    { checkIn: "2026-10-03", checkOut: "2026-10-09", nightlyRate: 500 }, // 6 nights
    { checkIn: "2026-10-20", checkOut: "2026-10-21", nightlyRate: 0 }, // no price: ignored
  ];
  assert.deepEqual(airbnbRateNear(stays, "2026-10-01", 2), {
    rate: 475, // (2 x 400 + 6 x 500) / 8
    stays: 2,
    from: "2026-09-20",
    to: "2026-10-09",
  });
  assert.equal(airbnbRateNear(stays, "2026-10-01")?.stays, 3);
  assert.equal(airbnbRateNear([], "2026-10-01"), null);
});

const unitRates = { weekendRate: 347, weeklyDiscountPct: 5, monthlyDiscountPct: 15 };

test("a form follows the unit's weekend rate and long-stay discount until staff type their own nightly rate", () => {
  assert.deepEqual(formPriceDefaults({ ownRate: false, fromAirbnb: false, nights: 30, unit: unitRates }), {
    weekendRate: "347",
    discountPct: 15,
  });
  assert.deepEqual(formPriceDefaults({ ownRate: false, fromAirbnb: false, nights: 3, unit: unitRates }), {
    weekendRate: "347",
    discountPct: 0,
  });
});

test("a nightly rate staff type is charged on every night: no weekend rate and no discount on top", () => {
  const defaults = formPriceDefaults({ ownRate: true, fromAirbnb: false, nights: 30, unit: unitRates });
  assert.deepEqual(defaults, { weekendRate: "", discountPct: 0 });
  // A direct client at AED 450 a night, Thu 8 Oct -> Sun 15 Nov 2026 (38 nights, weekends included).
  const q = quoteStay("2026-10-08", "2026-11-15", { nightly: 450, weekend: Number(defaults.weekendRate) }, defaults.discountPct);
  assert.equal(q.nights, 38);
  assert.equal(q.accommodation, 38 * 450);
});

test("an Airbnb average already carries weekends and long-stay discounts", () => {
  assert.deepEqual(formPriceDefaults({ ownRate: false, fromAirbnb: true, nights: 30, unit: unitRates }), {
    weekendRate: "",
    discountPct: 0,
  });
  assert.deepEqual(formPriceDefaults({ ownRate: false, fromAirbnb: false, nights: 5, unit: null }), {
    weekendRate: "",
    discountPct: 0,
  });
});
