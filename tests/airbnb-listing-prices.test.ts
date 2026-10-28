import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAirbnbListing } from "@/lib/airbnb/listing-collect";
import {
  currencyOf,
  hasPrices,
  isHostPage,
  nightFromLabel,
  parseAirbnbPrices,
  seasonsFromNights,
} from "@/lib/airbnb/listing-prices";
import { parseSeasons, seasonsToText } from "@/lib/website-options";

const TODAY = "2026-10-10";
const PRICING = "https://www.airbnb.com/hosting/listings/editor/12345/details/pricing";

// The Pricing page's text as the browser shows it.
const PAGE = `Listing editor
Pricing
Nightly price
AED 450
Guest price before taxes AED 521
Weekend price
AED 520
Discounts
Weekly
For 7 nights or more
10%
Monthly
For 28 nights or more
22.5%
Additional charges
Cleaning fee
AED 150
Short-stay cleaning fee
AED 90`;

test("reads the Pricing page's text", () => {
  assert.deepEqual(parseAirbnbPrices({ u: PRICING, text: PAGE }, TODAY), {
    currency: "AED",
    nightly: 450,
    weekend: 520,
    cleaning: 150,
    weeklyDiscount: 10,
    monthlyDiscount: 22.5,
    nights: [],
  });
});

test("an unset value never takes its neighbour's", () => {
  const p = parseAirbnbPrices({ u: PRICING, text: "Nightly price\nAED 300\nWeekly\nMonthly\n20%" }, TODAY);
  assert.equal(p.weeklyDiscount, null);
  assert.equal(p.monthlyDiscount, 20);
  assert.equal(p.weekend, null);
});

test("prefers the page's JSON, with factors as percent off", () => {
  const p = parseAirbnbPrices(
    {
      u: PRICING,
      text: PAGE,
      prices: { nightly: 470, weeklyFactor: 0.85, monthlyFactor: "0.7", cleaning: { amount: 175 }, currency: "AED" },
    },
    TODAY
  );
  assert.deepEqual([p.nightly, p.weekend, p.cleaning, p.weeklyDiscount, p.monthlyDiscount], [470, 520, 150, 15, 30]);
  // { amount } objects are unwrapped by the collector, not here.
  const sent = collectAirbnbListing(
    {
      body: { innerText: "" },
      querySelectorAll: (s: string) =>
        s.startsWith("script")
          ? [{ textContent: JSON.stringify({ listing: { defaultDailyPrice: 470, cleaningFee: { amount: 175 }, listingCurrency: "AED" } }) }]
          : [],
      querySelector: () => null,
    } as unknown as Document,
    PRICING,
    false
  );
  assert.deepEqual(sent.prices, { nightly: 470, cleaning: 175, currency: "AED" });
  assert.equal(parseAirbnbPrices(sent, TODAY).cleaning, 175);
});

test("tells the currency, and reads nothing from a guest's page", () => {
  assert.equal(parseAirbnbPrices({ u: PRICING, text: PAGE.replace(/AED /g, "$") }, TODAY).currency, "USD");
  assert.equal(currencyOf("€1,200"), "EUR");
  assert.equal(currencyOf("INR 9,000"), "INR");
  assert.equal(currencyOf("450"), null);
  const guest = parseAirbnbPrices({ u: "https://www.airbnb.com/rooms/12345", text: "AED 450 night\nCleaning fee\nAED 150" }, TODAY);
  assert.equal(hasPrices(guest), false);
  // Pasted, no address: the pricing labels are enough.
  assert.equal(parseAirbnbPrices({ text: PAGE }, TODAY).nightly, 450);
  assert.ok(isHostPage("https://www.airbnb.ae/multicalendar/12345"));
  assert.ok(!isHostPage(null));
  for (const junk of [null, 1, "x", { u: PRICING, nights: [5, "nonsense"], prices: "x" }]) {
    assert.equal(hasPrices(parseAirbnbPrices(junk, TODAY)), false);
  }
});

test("reads calendar days and merges them into seasons", () => {
  assert.deepEqual(nightFromLabel("Thursday, October 15, 2026, AED 450, available", TODAY), {
    date: "2026-10-15",
    price: 450,
    currency: "AED",
  });
  assert.deepEqual(nightFromLabel("Sat 26 December 2026 AED 1,200", TODAY)?.price, 1200);
  assert.equal(nightFromLabel("October 15, 2026, blocked", TODAY), null);

  const labels = [
    "December 24, 2026, AED 450",
    "December 25, 2026, AED 900",
    "December 26, 2026, AED 900",
    "December 27, 2026, AED 900",
    "December 29, 2026, AED 900",
    "December 30, 2026, AED 1,500",
    "December 31, 2026, AED 1,500",
    "October 1, 2026, AED 700",
  ];
  // Days labelled with their date, on one listing's own page.
  const p = parseAirbnbPrices({ u: "https://www.airbnb.com/hosting/listings/editor/12345/details/pricing", nights: labels }, TODAY);
  assert.equal(p.currency, "AED");
  assert.equal(p.nights.length, 8);
  const rows = seasonsFromNights(p.nights, 450, TODAY);
  assert.deepEqual(rows, [
    { name: "Airbnb", from: "2026-12-25", to: "2026-12-27", rate: 900 },
    { name: "Airbnb", from: "2026-12-29", to: "2026-12-29", rate: 900 },
    { name: "Airbnb", from: "2026-12-30", to: "2026-12-31", rate: 1500 },
  ]);
  // What the form saves reads back the same.
  assert.deepEqual(parseSeasons(seasonsToText(rows)), { seasons: rows });

  const mixed = parseAirbnbPrices(
    { u: "https://www.airbnb.com/hosting/listings/editor/1/details/pricing", nights: ["Dec 1, 2026, $100", "Dec 2, 2026, AED 400"] },
    TODAY
  );
  assert.equal(mixed.currency, "mixed");
});
