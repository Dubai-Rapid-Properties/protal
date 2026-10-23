import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TICKET_PHOTOS, ticketPhotoPath, ticketPhotoProblem } from "@/lib/tickets/photos";
import { can } from "@/lib/auth/rbac";

test("ticket photos live in the ticket's own folder", () => {
  assert.equal(ticketPhotoPath("t1", "Leak under sink!.HEIC", "image/heic", 5), "ticket/t1/5-Leak-under-sink.heic");
  assert.equal(ticketPhotoPath("t1", ".jpg", "image/jpeg", 5), "ticket/t1/5-photo.jpg");
  assert.equal(MAX_TICKET_PHOTOS, 12);
  assert.equal(ticketPhotoProblem({ name: "a.jpg", type: "image/jpeg", size: 100 }), null);
  assert.ok(ticketPhotoProblem({ name: "a.gif", type: "image/gif", size: 100 }));
});

test("staff who raise tickets and owners may add photos", () => {
  for (const role of ["super_admin", "property_manager", "agent", "maintenance", "owner"] as const) {
    assert.equal(can(role, "maintenance.raise"), true, role);
  }
});
