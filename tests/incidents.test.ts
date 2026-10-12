import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INCIDENT_CATEGORIES,
  MAX_INCIDENT_PHOTO_BYTES,
  incidentPhotoPath,
  incidentPhotoProblem,
} from "@/lib/incidents";
import { can } from "@/lib/auth/rbac";

test("incident categories match the database check (0033)", () => {
  assert.deepEqual(INCIDENT_CATEGORIES, [
    "vomit", "mess", "damage", "smoking", "party_noise",
    "extra_guests", "pets", "missing_items", "rule_breach", "other",
  ]);
});

test("only photos within the size limit are accepted", () => {
  assert.equal(incidentPhotoProblem({ name: "a.jpg", type: "image/jpeg", size: 500_000 }), null);
  assert.equal(incidentPhotoProblem({ name: "a.heic", type: "image/heic", size: 500_000 }), null);
  assert.match(incidentPhotoProblem({ name: "a.pdf", type: "application/pdf", size: 10 })!, /JPG, PNG/);
  assert.match(incidentPhotoProblem({ name: "a.jpg", type: "image/jpeg", size: 0 })!, /empty/);
  assert.match(
    incidentPhotoProblem({ name: "big.jpg", type: "image/jpeg", size: MAX_INCIDENT_PHOTO_BYTES + 1 })!,
    /larger than 4 MB/
  );
});

test("photos are stored under the incident, with a safe name", () => {
  const id = "0b7f6c1e-1111-4222-8333-944445555666";
  assert.equal(
    incidentPhotoPath(id, "IMG 2041 (1).HEIC", "image/heic", 1700000000000),
    `incident/${id}/1700000000000-IMG-2041-1.heic`
  );
  assert.equal(incidentPhotoPath(id, "../../etc.jpg", "image/jpeg", 1), `incident/${id}/1-etc.jpg`);
  assert.equal(incidentPhotoPath(id, "???.png", "image/png", 1), `incident/${id}/1-photo.png`);
});

test("owners, tenants and guests cannot see incidents; staff can", () => {
  for (const role of ["owner", "tenant", "guest"] as const) {
    assert.equal(can(role, "incidents.view"), false, role);
    assert.equal(can(role, "incidents.report"), false, role);
  }
  for (const role of ["super_admin", "property_manager", "agent", "maintenance"] as const) {
    assert.equal(can(role, "incidents.report"), true, role);
  }
  assert.equal(can("finance", "incidents.view"), true);
  assert.equal(can("finance", "incidents.report"), false);
});
