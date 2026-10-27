import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAirbnbListing } from "@/lib/airbnb/listing-collect";
import { nightFromLabel, parseAirbnbPrices } from "@/lib/airbnb/listing-prices";
import { amountIn } from "@/lib/airbnb/reservation-page";

const TODAY = "2026-10-27";
const CALENDAR = "https://www.airbnb.co.uk/multicalendar/1703596941988303704";

// The calendar's side panel as the browser shows it, dirhams after the amount
// and wrapped in right-to-left marks.
const PANEL = `November
Mon
Tue
386‏د.إ‏
Pricing
229 ‏د.إ‏ per night
234 ‏د.إ‏ weekend price
Discounts
2% weekly discount
7% monthly discount
Availability
2–365 night stays`;

test("reads the calendar's side panel, value first", () => {
  assert.deepEqual(parseAirbnbPrices({ u: CALENDAR, text: PANEL }, TODAY), {
    currency: "AED",
    nightly: 229,
    weekend: 234,
    cleaning: null,
    weeklyDiscount: 2,
    monthlyDiscount: 7,
    nights: [],
  });
});

test("the Pricing page's labels still win over the panel's lines", () => {
  const p = parseAirbnbPrices({ u: CALENDAR, text: "Nightly price\nAED 450\nAED 521 per night" }, TODAY);
  assert.equal(p.nightly, 450);
});

test("an amount with dirhams after it", () => {
  assert.equal(amountIn("386د.إ"), 386);
  assert.equal(amountIn("1 386 د.إ"), 386);
  assert.equal(amountIn("1,250د.إ, 2 nights"), 1250);
  // A currency before the amount is still the first choice.
  assert.equal(amountIn("Thursday, October 15, 2026, AED 450, available"), 450);
});

test("calendar days dated in an attribute or a label, priced in the day", () => {
  assert.deepEqual(nightFromLabel("2026-11-12 12 415‏د.إ", TODAY), { date: "2026-11-12", price: 415, currency: "AED" });
  assert.deepEqual(nightFromLabel("Saturday, 1 November 2026, unavailable 1 386د.إ", TODAY), {
    date: "2026-11-01",
    price: 386,
    currency: "AED",
  });
});

/** A minimal Document: days carry data-testid or aria-label; textContent runs their parts together. */
function fakeDoc(days: { attrs: Record<string, string>; text: string; shown: string }[], bodyText: string): Document {
  const els = days.map((d) => ({
    getAttribute: (n: string) => d.attrs[n] ?? null,
    textContent: d.text,
    innerText: d.shown,
  }));
  return {
    body: { innerText: bodyText },
    querySelectorAll: (sel: string) => {
      if (sel.startsWith("script") || sel.startsWith("img")) return [];
      if (sel.includes("data-testid")) return els.filter((e) => ["data-testid", "data-date", "data-day", "data-key"].some((a) => e.getAttribute(a)));
      if (sel.includes("aria-label")) return els.filter((e) => e.getAttribute("aria-label") || e.getAttribute("title"));
      return [];
    },
    querySelector: () => null,
  } as unknown as Document;
}

test("collects calendar days without running the day and price together", () => {
  const sent = collectAirbnbListing(
    fakeDoc(
      [
        { attrs: { "data-testid": "calendar-day-2026-11-12" }, text: "12415د.إ", shown: "12\n415د.إ" },
        { attrs: { "aria-label": "Saturday, 1 November 2026" }, text: "1386د.إ", shown: "1\n386د.إ" },
      ],
      PANEL
    ),
    CALENDAR,
    true
  );
  assert.deepEqual(sent.nights, ["2026-11-12 12 415د.إ", "Saturday, 1 November 2026 1 386د.إ"]);
  assert.deepEqual(parseAirbnbPrices(sent, TODAY).nights, [
    { date: "2026-11-01", price: 386 },
    { date: "2026-11-12", price: 415 },
  ]);
});
