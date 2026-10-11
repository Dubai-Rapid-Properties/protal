import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPermitNumbers, seasonsOf, toWebsiteHome, type UnitRow } from "@/lib/website-homes";
import { parseSeasons } from "@/lib/website-options";

const unit = (over: Partial<UnitRow> = {}) =>
  ({
    website_slug: "marina-gate-2br",
    website_title: "Marina Gate 2 BR",
    website_area: "Dubai Marina",
    website_type: "apartment",
    website_images: ["https://x.supabase.co/a.jpg", "http://insecure/b.jpg", 5],
    base_nightly_rate_aed: "850.00",
    max_guests: 4,
    bedrooms: 2.5,
    bathrooms: 2,
    size_sqft: "1100.4",
    min_nights: null,
    cleaning_fee_aed: "150",
    weekend_rate_aed: null,
    weekly_discount_pct: "10",
    monthly_discount_pct: null,
    website_amenities: ["wifi"],
    website_highlights: [],
    website_house_rules: [],
    website_check_in: "15:00",
    website_check_out: "11:00",
    website_seasons: [],
    website_lat: null,
    website_lng: null,
    website_building: null,
    website_tag: null,
    website_description: null,
    website_maps_url: null,
    ...over,
  }) as unknown as UnitRow;

test("maps a complete unit and keeps only https photos", () => {
  const h = toWebsiteHome(unit())!;
  assert.equal(h.bedrooms, 2);
  assert.equal(h.pricePerNight, 850);
  assert.equal(h.cleaningFee, 150);
  assert.equal(h.minNights, 1);
  assert.deepEqual(h.gallery, ["https://x.supabase.co/a.jpg"]);
  assert.equal(h.pricing.weeklyDiscountPct, 10);
  assert.equal(h.sizeSqft, 1100);
});

test("a unit missing what the website needs is not shown", () => {
  assert.equal(toWebsiteHome(unit({ website_images: [] })), null);
  assert.equal(toWebsiteHome(unit({ base_nightly_rate_aed: "0" as never })), null);
  assert.equal(toWebsiteHome(unit({ website_slug: null })), null);
});

test("malformed season rows are dropped, good ones kept", () => {
  const rows = seasonsOf({
    website_seasons: [
      { name: "NY", from: "2026-12-26", to: "2027-01-03", rate: 2400 },
      { from: "2026-12-26", to: "2026-12-01", rate: 100 },
      { from: "x", to: "2027-01-03", rate: 100 },
      { from: "2026-01-01", to: "2026-01-02", rate: 0 },
      "junk",
    ],
  });
  assert.deepEqual(rows, [{ name: "NY", from: "2026-12-26", to: "2027-01-03", rate: 2400 }]);
});

test("season text is parsed and bad lines are reported", () => {
  assert.equal(parseSeasons("NY | 2026-12-26 | 2027-01-03 | 2400\n\n").seasons.length, 1);
  assert.match(parseSeasons("NY | 2026-12-26 | nope | 2400").error ?? "", /line 1/);
});

test("the permit number shown is an active permit valid today, the longest-running one", () => {
  const rows = [
    { unit_id: "a", permit_number: "OLD-1", status: "active", issued_on: "2025-01-01", expires_on: "2026-12-31" },
    { unit_id: "a", permit_number: "NEW-2", status: "active", issued_on: "2026-06-01", expires_on: "2027-05-31" },
    { unit_id: "b", permit_number: "EXPIRED", status: "active", issued_on: "2025-01-01", expires_on: "2026-01-31" },
    { unit_id: "c", permit_number: "LATER", status: "active", issued_on: "2026-11-01", expires_on: "2027-10-31" },
    { unit_id: "d", permit_number: "PENDING", status: "pending", issued_on: "2026-01-01", expires_on: "2027-01-01" },
  ] as Parameters<typeof currentPermitNumbers>[0];
  const m = currentPermitNumbers(rows, "2026-10-11");
  assert.equal(m.get("a"), "NEW-2");
  assert.equal(m.has("b"), false);
  assert.equal(m.has("c"), false);
  assert.equal(m.has("d"), false);
  assert.equal(toWebsiteHome(unit(), m.get("a") ?? null)!.permitNumber, "NEW-2");
  assert.equal(toWebsiteHome(unit())!.permitNumber, null);
});
