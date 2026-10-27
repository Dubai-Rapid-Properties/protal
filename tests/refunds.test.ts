import { test } from "node:test";
import assert from "node:assert/strict";
import { REFUND_PEOPLE, isPdf, receiptPath, receiptProblem, refundImageName, refundReference } from "@/lib/refunds";
import { wrapText } from "@/lib/refund-image";
import { can } from "@/lib/auth/rbac";

test("receipts: photos and PDFs up to 4 MB", () => {
  assert.equal(receiptProblem({ name: "r.jpg", type: "image/jpeg", size: 200_000 }), null);
  assert.equal(receiptProblem({ name: "r.pdf", type: "application/pdf", size: 200_000 }), null);
  assert.match(receiptProblem({ name: "r.docx", type: "application/msword", size: 10 })!, /photo .* or a PDF/);
  assert.match(receiptProblem({ name: "big.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 })!, /larger than 4 MB/);
  assert.equal(receiptPath("abc", "application/pdf", 1), "refund/abc/1-receipt.pdf");
  assert.ok(isPdf(receiptPath("abc", "application/pdf")));
});

test("every staff member sees refunds; only super admins settle; owners neither", () => {
  for (const role of ["super_admin", "property_manager", "agent", "maintenance", "finance", "marketing"] as const) {
    assert.equal(can(role, "refunds.view"), true, role);
  }
  assert.equal(can("super_admin", "refunds.settle"), true);
  assert.equal(can("finance", "refunds.settle"), false);
  assert.equal(can("owner", "refunds.view"), false);
  assert.deepEqual([...REFUND_PEOPLE], ["Jasko", "Tara", "Ann", "Delia", "Dulshan"]);
});

test("the refunded image: reference, file name, wrapped text", () => {
  assert.equal(refundReference("3f2a9c1e-77b0-4d2e-9a1b-0c3d4e5f6a7b"), "RF-3F2A9C1E");
  assert.equal(refundImageName({ spent_by: "Jasko", settled_on: "2026-10-27" }), "refund-jasko-2026-10-27.png");
  assert.equal(refundImageName({ spent_by: "Ann Marie", settled_on: null }), "refund-ann-marie.png");

  const measure = (s: string) => s.length;
  assert.deepEqual(wrapText("Printer ink and paper", 12, measure, 3), ["Printer ink", "and paper"]);
  assert.deepEqual(wrapText("one two three four five six", 9, measure, 2), ["one two", "three…"]);
  assert.deepEqual(wrapText("abcdefghij", 4, measure, 5), ["abcd", "efgh", "ij"]);
});
