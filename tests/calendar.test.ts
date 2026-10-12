import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  coversNight,
  dubaiToday,
  monthGrid,
  monthRange,
  monthSpanRange,
  nightsBetween,
  nightsWithin,
  parseMonth,
  parseMonthSpan,
  rangesOverlap,
  shiftMonth,
  uncoveredRanges,
} from "@/lib/calendar";

test("month arithmetic", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(monthRange("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(monthRange("2026-09"), { start: "2026-09-01", end: "2026-09-30" });
});

test("parseMonth rejects junk and defaults to the Dubai month", () => {
  const now = new Date("2026-09-30T21:00:00Z"); // already 1 Oct in Dubai
  assert.equal(parseMonth("2026-03", now), "2026-03");
  assert.equal(parseMonth("2026-13", now), "2026-10");
  assert.equal(parseMonth("'; drop table", now), "2026-10");
  assert.equal(parseMonth(undefined, now), "2026-10");
  assert.equal(dubaiToday(now), "2026-10-01");
});

test("parseMonthSpan only accepts the offered spans", () => {
  assert.equal(parseMonthSpan("3"), 3);
  assert.equal(parseMonthSpan("12"), 12);
  assert.equal(parseMonthSpan("4"), 1);
  assert.equal(parseMonthSpan("1e1", 3), 3);
  assert.equal(parseMonthSpan(undefined, 3), 3);
});

test("monthSpanRange covers every grid in the span", () => {
  assert.deepEqual(monthSpanRange("2026-09", 1), { start: "2026-08-31", end: "2026-10-05" });
  // Sep-Nov 2026: 30 Nov is a Monday, so the last grid runs to Sun 6 Dec.
  assert.deepEqual(monthSpanRange("2026-09", 3), { start: "2026-08-31", end: "2026-12-07" });
});

test("monthGrid starts on Monday and covers the whole month", () => {
  const weeks = monthGrid("2026-09"); // 1 Sep 2026 is a Tuesday
  assert.equal(weeks[0][0], "2026-08-31");
  assert.equal(weeks[0][1], "2026-09-01");
  assert.ok(weeks.every((w) => w.length === 7));
  assert.ok(weeks.flat().includes("2026-09-30"));
  assert.equal(weeks.at(-1)!.at(-1), "2026-10-04");
  // February 2021 starts on Monday and fits exactly four weeks.
  assert.equal(monthGrid("2021-02").length, 4);
});

test("stays are half-open, matching the database constraint", () => {
  assert.equal(nightsBetween("2026-09-10", "2026-09-15"), 5);
  assert.equal(coversNight("2026-09-10", "2026-09-10", "2026-09-15"), true);
  assert.equal(coversNight("2026-09-14", "2026-09-10", "2026-09-15"), true);
  assert.equal(coversNight("2026-09-15", "2026-09-10", "2026-09-15"), false);
  // Same-day turnaround does not overlap.
  assert.equal(rangesOverlap("2026-09-10", "2026-09-15", "2026-09-15", "2026-09-20"), false);
  assert.equal(rangesOverlap("2026-09-10", "2026-09-15", "2026-09-14", "2026-09-20"), true);
});

test("nightsWithin clips a stay to a window", () => {
  assert.equal(nightsWithin("2026-08-29", "2026-09-03", "2026-09-01", "2026-09-30"), 2);
  assert.equal(nightsWithin("2026-09-28", "2026-10-05", "2026-09-01", "2026-09-30"), 3);
  assert.equal(nightsWithin("2026-10-01", "2026-10-05", "2026-09-01", "2026-09-30"), 0);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("uncoveredRanges leaves what a block still has free", () => {
  const block = ["2026-09-29", "2026-11-11"] as const;
  assert.deepEqual(uncoveredRanges(...block, []), [{ start: "2026-09-29", end: "2026-11-11" }]);
  assert.deepEqual(uncoveredRanges(...block, [{ start: "2026-09-29", end: "2026-11-11" }]), []);
  assert.deepEqual(
    uncoveredRanges(...block, [
      { start: "2026-10-20", end: "2026-10-25" },
      { start: "2026-09-29", end: "2026-10-05" },
      { start: "2026-10-25", end: "2026-11-15" },
    ]),
    [{ start: "2026-10-05", end: "2026-10-20" }]
  );
  // Stays that start before or run past the block count only inside it.
  assert.deepEqual(uncoveredRanges(...block, [{ start: "2026-09-20", end: "2026-10-01" }]), [
    { start: "2026-10-01", end: "2026-11-11" },
  ]);
  assert.deepEqual(uncoveredRanges(...block, [{ start: "2026-12-01", end: "2026-12-05" }]), [
    { start: "2026-09-29", end: "2026-11-11" },
  ]);
});
