import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAirbnbListing } from "@/lib/airbnb/listing-collect";
import { nightFromLabel, parseAirbnbPrices } from "@/lib/airbnb/listing-prices";
import { amountIn } from "@/lib/airbnb/reservation-page";

const TODAY = "2026-10-27";
const CALENDAR = "https://www.airbnb.co.uk/multicalendar/1703596941988303704";
const EDITOR = "https://www.airbnb.co.uk/hosting/listings/editor/1703596941988303704/details/pricing";

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
  const p = parseAirbnbPrices({ u: EDITOR, text: "Nightly price\nAED 450\nAED 521 per night" }, TODAY);
  assert.equal(p.nightly, 450);
  // On the calendar every day has a "Nightly price" of its own: only the side panel counts there.
  const c = parseAirbnbPrices({ u: CALENDAR, text: "1\nNightly priceﺩ.ﺇ386\nPricing\nﺩ.ﺇ\u00a0229 per night" }, TODAY);
  assert.deepEqual([c.currency, c.nightly], ["AED", 229]);
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

test("the calendar counts only its side panel and month grid, not other listings in the page", () => {
  const p = parseAirbnbPrices(
    {
      u: CALENDAR,
      text: PANEL,
      // Another listing's settings and days, kept in the multi-listing calendar's page.
      prices: { nightly: 185, currency: "AED" },
      nights: ["Wednesday, October 28, 2026, د.إ343", "Thursday, October 29, 2026, د.إ185"],
      months: [{ name: "December 2026", days: [["Monday 28 Dec", "28", "Nightly price", "\uFEA9.\uFE87900"]] }],
    },
    TODAY
  );
  assert.equal(p.nightly, 229);
  assert.deepEqual(p.nights, [{ date: "2026-12-28", price: 900 }]);
  // The Pricing page is one listing's: its page settings still count.
  assert.equal(parseAirbnbPrices({ u: EDITOR, text: PANEL, prices: { nightly: 185, currency: "AED" } }, TODAY).nightly, 185);
});

test("collects calendar days without running the day and price together", () => {
  const sent = collectAirbnbListing(
    fakeDoc(
      [
        { attrs: { "data-testid": "calendar-day-2026-11-12" }, text: "12415د.إ", shown: "12\n415د.إ" },
        { attrs: { "aria-label": "Saturday, 1 November 2026" }, text: "1386د.إ", shown: "1\n386د.إ" },
      ],
      PANEL
    ),
    EDITOR,
    true
  );
  assert.deepEqual(sent.nights, ["2026-11-12 12 415د.إ", "Saturday, 1 November 2026 1 386د.إ"]);
  assert.deepEqual(parseAirbnbPrices(sent, TODAY).nights, [
    { date: "2026-11-01", price: 386 },
    { date: "2026-11-12", price: 415 },
  ]);
});

test("dirhams however the page writes them", () => {
  const read = (text: string) => parseAirbnbPrices({ u: CALENDAR, text }, TODAY);
  // Presentation-form letters, an Arabic full stop, the letters reversed, the dirham sign.
  for (const aed of ["ﺩ.ﺇ", "د۔إ", "إ.د", "⃃", "د.ا"]) {
    const p = read(`229 ${aed} per night\n234 ${aed} weekend price`);
    assert.deepEqual([p.currency, p.nightly, p.weekend], ["AED", 229, 234], aed);
  }
  assert.deepEqual(nightFromLabel("2026-11-12 12 415⃃", TODAY), { date: "2026-11-12", price: 415, currency: "AED" });
});

test("amounts without a currency take the one on the page's currency button", () => {
  const p = parseAirbnbPrices({ u: CALENDAR, text: "Pricing\n229 per night\n234 weekend price\nToday\nAED" }, TODAY);
  assert.deepEqual([p.currency, p.nightly, p.weekend], ["AED", 229, 234]);
  assert.equal(parseAirbnbPrices({ u: CALENDAR, text: "229 per night" }, TODAY).currency, null);
});

test("the price sync gets the whole page; the address hand-over is trimmed", () => {
  // A big calendar first, its side panel last.
  const days = Array.from({ length: 3000 }, (_, i) => `${(i % 30) + 1}\n415د.إ`).join("\n");
  const text = `${days}\n${PANEL}`;
  const posted = collectAirbnbListing(fakeDoc([], text), CALENDAR, true, false);
  assert.equal(parseAirbnbPrices(posted, TODAY).nightly, 229);
  const handed = collectAirbnbListing(fakeDoc([], text), CALENDAR, true);
  assert.ok(handed.text.length < posted.text.length);
});

// Month grids as the extension collects them from Airbnb's calendar (Calendar → Month), in the
// real page's format: the day's own label, its number, and "Nightly price" with dirhams first.
test("reads the calendar's month grids", () => {
  const AED = "ﺩ.ﺇ";
  const months = [
    {
      name: "December 2026",
      days: [
        ["Contains a note", "Tuesday 1 Dec", "1", "Unavailable", "Nightly price", `${AED}415`],
        ["Wednesday 2 Dec", "2"], // booked: no price shown
        ["Sunday 13 Dec", "13", "Nightly price", `${AED}350`],
        ["Monday 28 Dec", "28", "Nightly price", `${AED}900`, "1-night minimum"],
      ],
    },
    { name: "January 2027", days: [["Friday 1 Jan", "1", "Nightly price", `${AED}900`]] },
    // A grid whose days do not fall on its year's weekdays is left out, not guessed.
    { name: "March 2027", days: [["Tuesday 1 Mar", "1", "Nightly price", `${AED}999`]] },
  ];
  const p = parseAirbnbPrices({ u: CALENDAR, text: `Pricing\n${AED} 229 per night`, months }, TODAY);
  assert.deepEqual(p.nights, [
    { date: "2026-12-01", price: 415 },
    { date: "2026-12-13", price: 350 },
    { date: "2026-12-28", price: 900 },
    { date: "2027-01-01", price: 900 },
  ]);
  assert.equal(p.currency, "AED");
  assert.equal(p.nightly, 229);
  assert.equal(
    p.calendar,
    'Dec 2026: 4 days, 3 priced; Jan 2027: 1 days, 1 priced; Mar 2027: left out ("Tuesday 1 Mar" is not in Mar 2027)'
  );
});
