import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, can } from "@/lib/auth/rbac";

test("housekeeping sees stays, check-ins and check-outs but not what they earn", () => {
  assert.equal(can("maintenance", "bookings.view"), true);
  assert.equal(can("maintenance", "bookings.revenue"), false);
  assert.equal(can("maintenance", "bookings.manage"), false);
  assert.equal(can("maintenance", "finance.view"), false);
});

test("housekeeping sees and adds repairs and guest incidents", () => {
  for (const capability of ["maintenance.view", "maintenance.raise", "incidents.view", "incidents.report"] as const) {
    assert.equal(can("maintenance", capability), true, capability);
  }
});

test("every other role that saw bookings still sees their money", () => {
  for (const [role, capabilities] of Object.entries(CAPABILITIES)) {
    if (role === "maintenance" || role === "owner" || role === "guest") continue;
    if (capabilities.includes("bookings.view")) {
      assert.ok(capabilities.includes("bookings.revenue"), role);
    }
  }
});
