import { test } from "node:test";
import assert from "node:assert/strict";
import { dayCounts, dayLabel, onDay, parseDay } from "@/lib/booking-day";

const today = "2026-10-27";

test("the day: today by default, a real date otherwise, named when it is near", () => {
  assert.equal(parseDay(undefined, today), today);
  assert.equal(parseDay("2026-10-28", today), "2026-10-28");
  assert.equal(parseDay("2026-02-30", today), today);
  assert.equal(parseDay("tomorrow", today), today);
  assert.equal(dayLabel(today, today), "Today");
  assert.equal(dayLabel("2026-10-26", today), "Yesterday");
  assert.equal(dayLabel("2026-10-28", today), "Tomorrow");
  assert.equal(dayLabel("2026-10-30", today), "30 Oct 2026");
  assert.equal(onDay("Arriving", "2026-10-28", today), "Arriving tomorrow");
  assert.equal(onDay("In house", "2026-10-30", today), "In house 30 Oct 2026");
});

test("today: an arrival counts as arriving until checked in, then as in house", () => {
  const stays = [
    { status: "confirmed", check_in: today, check_out: "2026-10-30" },
    { status: "checked_in", check_in: today, check_out: "2026-10-29" },
    { status: "confirmed", check_in: "2026-10-20", check_out: today },
    { status: "checked_in", check_in: "2026-10-25", check_out: "2026-11-01" },
  ];
  assert.deepEqual(dayCounts(stays, today, today), { arriving: 1, departing: 1, inHouse: 2 });
});

test("another day goes by the dates: yesterday's guests who checked out still count", () => {
  const yesterday = "2026-10-26";
  const stays = [
    { status: "checked_out", check_in: yesterday, check_out: today },
    { status: "checked_in", check_in: yesterday, check_out: "2026-10-30" },
    { status: "checked_out", check_in: "2026-10-20", check_out: yesterday },
    { status: "checked_out", check_in: "2026-10-22", check_out: today },
    { status: "cancelled", check_in: yesterday, check_out: "2026-10-28" },
  ];
  assert.deepEqual(dayCounts(stays, yesterday, today), { arriving: 2, departing: 1, inHouse: 1 });
});

test("tomorrow: confirmed arrivals, and today's guests staying on", () => {
  const tomorrow = "2026-10-28";
  const stays = [
    { status: "confirmed", check_in: tomorrow, check_out: "2026-11-02" },
    { status: "tentative", check_in: tomorrow, check_out: "2026-11-02" },
    { status: "checked_in", check_in: "2026-10-25", check_out: tomorrow },
    { status: "confirmed", check_in: today, check_out: "2026-10-31" },
  ];
  assert.deepEqual(dayCounts(stays, tomorrow, today), { arriving: 1, departing: 1, inHouse: 1 });
});
