import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_PRICES, type AirbnbPrices } from "@/lib/airbnb/listing-prices";
import { mergeCalendarSeasons, planPriceSync, storedSeasons, type UnitRates } from "@/lib/airbnb/price-sync";

// A Saturday; 2026-10-16 and 2026-10-17 are the next Friday and Saturday.
const TODAY = "2026-10-10";

const UNIT: UnitRates = {
  nightly: 450,
  weekend: 520,
  cleaning: 150,
  weeklyDiscount: 10,
  monthlyDiscount: null,
  seasons: [],
};

const prices = (p: Partial<AirbnbPrices>): AirbnbPrices => ({ ...NO_PRICES, nights: [], currency: "AED", ...p });

test("saves only what the page showed and changed", () => {
  const plan = planPriceSync(prices({ nightly: 480, weekend: 520, monthlyDiscount: 20 }), UNIT, TODAY);
  assert.ok(!("skip" in plan));
  assert.deepEqual(plan.rates, { nightly: 480, monthlyDiscount: 20 });
  assert.equal(plan.seasons, undefined);
  assert.deepEqual(plan.changes, ["Nightly AED 450 → AED 480", "Monthly discount none → 20%"]);
});

test("the same prices change nothing", () => {
  const plan = planPriceSync(prices({ nightly: 450, cleaning: 150 }), UNIT, TODAY);
  assert.deepEqual(plan, { rates: {}, changes: [] });
});

test("a nightly rate of 0 is never saved", () => {
  const plan = planPriceSync(prices({ nightly: 0, cleaning: 200 }), UNIT, TODAY);
  assert.ok(!("skip" in plan));
  assert.deepEqual(plan.rates, { cleaning: 200 });
});

test("nothing is saved without AED", () => {
  assert.ok("skip" in planPriceSync(prices({ nightly: 120, currency: "USD" }), UNIT, TODAY));
  assert.ok("skip" in planPriceSync(prices({ nightly: 120, currency: "mixed" }), UNIT, TODAY));
  assert.ok("skip" in planPriceSync(prices({ nightly: 480, currency: null }), UNIT, TODAY));
  assert.ok("skip" in planPriceSync(prices({}), UNIT, TODAY));
});

test("calendar nights at the usual rate need no season; others merge into rows", () => {
  const nights = [
    { date: "2026-10-09", price: 999 }, // past
    { date: "2026-10-14", price: 450 }, // Wednesday at the nightly rate
    { date: "2026-10-15", price: 600 },
    { date: "2026-10-16", price: 520 }, // Friday at the weekend rate
    { date: "2026-10-17", price: 700 },
    { date: "2026-10-18", price: 700 },
    { date: "2026-10-19", price: 450 },
  ];
  assert.deepEqual(mergeCalendarSeasons([], nights, 450, 520, TODAY), [
    { name: "Airbnb", from: "2026-10-15", to: "2026-10-15", rate: 600 },
    { name: "Airbnb", from: "2026-10-17", to: "2026-10-18", rate: 700 },
  ]);
});

test("calendar nights replace seasons only on the dates they cover", () => {
  const existing = [
    { name: "Before", from: "2026-10-01", to: "2026-10-05", rate: 500 },
    { name: "Across", from: "2026-10-12", to: "2026-10-25", rate: 800 },
    { name: "New Year", from: "2026-12-28", to: "2027-01-02", rate: 1500 },
  ];
  const nights = [
    { date: "2026-10-14", price: 450 },
    { date: "2026-10-15", price: 610 },
    { date: "2026-10-20", price: 450 },
  ];
  assert.deepEqual(mergeCalendarSeasons(existing, nights, 450, 520, TODAY), [
    { name: "Before", from: "2026-10-01", to: "2026-10-05", rate: 500 },
    { name: "Across", from: "2026-10-12", to: "2026-10-13", rate: 800 },
    { name: "Airbnb", from: "2026-10-15", to: "2026-10-15", rate: 610 },
    { name: "Across", from: "2026-10-21", to: "2026-10-25", rate: 800 },
    { name: "New Year", from: "2026-12-28", to: "2027-01-02", rate: 1500 },
  ]);
  // No nights: the seasons stay exactly as they are.
  assert.equal(mergeCalendarSeasons(existing, [], 450, 520, TODAY), existing);
});

test("a plan says when the calendar changes the seasons, judged at the new rates", () => {
  const nights = [
    { date: "2026-10-14", price: 480 },
    { date: "2026-10-15", price: 480 },
  ];
  // At the new nightly rate of 480 these nights need no season.
  assert.deepEqual(planPriceSync(prices({ nightly: 480, nights }), UNIT, TODAY), {
    rates: { nightly: 480 },
    changes: ["Nightly AED 450 → AED 480"],
  });
  const plan = planPriceSync(prices({ nights }), UNIT, TODAY);
  assert.ok(!("skip" in plan));
  assert.deepEqual(plan.seasons, [{ name: "Airbnb", from: "2026-10-14", to: "2026-10-15", rate: 480 }]);
  assert.deepEqual(plan.changes, ["Calendar prices: 1 seasonal rate on the website"]);
});

test("stored seasons: well-formed rows only, in date order", () => {
  assert.deepEqual(
    storedSeasons([
      { name: "Late", from: "2026-12-01", to: "2026-12-05", rate: "900" },
      { from: "2026-11-01", to: "2026-11-02", rate: 700 },
      { name: "Bad", from: "2026-11-05", to: "2026-11-01", rate: 700 },
      { name: "No rate", from: "2026-11-05", to: "2026-11-06" },
      "nonsense",
    ]),
    [
      { name: "", from: "2026-11-01", to: "2026-11-02", rate: 700 },
      { name: "Late", from: "2026-12-01", to: "2026-12-05", rate: 900 },
    ]
  );
  assert.deepEqual(storedSeasons(null), []);
});
