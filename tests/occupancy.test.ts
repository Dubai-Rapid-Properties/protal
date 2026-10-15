import { test } from "node:test";
import assert from "node:assert/strict";
import { combineOccupancy, occupancy } from "@/lib/occupancy";

// November 2026: 30 nights.
const NOV = ["2026-11-01", "2026-12-01"] as const;

test("booked nights over the nights in the period", () => {
  const o = occupancy(...NOV, [{ start: "2026-11-05", end: "2026-11-20" }], []);
  assert.deepEqual(o, { booked: 15, available: 30, rate: 50 });
});

test("only the nights inside the period count", () => {
  const o = occupancy(...NOV, [{ start: "2026-10-25", end: "2026-11-04" }, { start: "2026-11-28", end: "2026-12-05" }], []);
  assert.equal(o.booked, 6); // 1-3 Nov and 28-30 Nov
});

test("an owner stay or block is not a night that could be let", () => {
  const o = occupancy(...NOV, [{ start: "2026-11-01", end: "2026-11-11" }], [{ start: "2026-11-21", end: "2026-12-01" }]);
  assert.deepEqual(o, { booked: 10, available: 20, rate: 50 });
});

test("a stay under an Airbnb block is counted once, as booked", () => {
  const o = occupancy(...NOV, [{ start: "2026-11-01", end: "2026-11-16" }], [{ start: "2026-11-01", end: "2026-11-16" }]);
  assert.deepEqual(o, { booked: 15, available: 30, rate: 50 });
});

test("a unit closed all period has no rate", () => {
  assert.equal(occupancy(...NOV, [], [{ start: "2026-10-01", end: "2027-01-01" }]).rate, null);
});

test("units together add up their nights", () => {
  const a = occupancy(...NOV, [{ start: "2026-11-01", end: "2026-12-01" }], []);
  const b = occupancy(...NOV, [], []);
  assert.deepEqual(combineOccupancy([a, b]), { booked: 30, available: 60, rate: 50 });
  assert.equal(combineOccupancy([]).rate, null);
});
