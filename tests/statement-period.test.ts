import { test } from "node:test";
import assert from "node:assert/strict";
import { statementPeriod } from "@/lib/dates";

test("statement period runs from the 16th to the latest 15th", () => {
  assert.deepEqual(statementPeriod("2026-10-23"), { start: "2026-09-16", end: "2026-10-15" });
  assert.deepEqual(statementPeriod("2026-10-15"), { start: "2026-09-16", end: "2026-10-15" });
  assert.deepEqual(statementPeriod("2026-10-14"), { start: "2026-08-16", end: "2026-09-15" });
});

test("statement period crosses the year", () => {
  assert.deepEqual(statementPeriod("2027-01-20"), { start: "2026-12-16", end: "2027-01-15" });
  assert.deepEqual(statementPeriod("2027-01-05"), { start: "2026-11-16", end: "2026-12-15" });
  assert.deepEqual(statementPeriod("2027-02-03"), { start: "2026-12-16", end: "2027-01-15" });
});
