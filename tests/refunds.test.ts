import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REFUND_PEOPLE,
  isPdf,
  paymentProofPath,
  receiptPath,
  receiptProblem,
} from "@/lib/refunds";
import { can } from "@/lib/auth/rbac";

test("receipts: photos and PDFs up to 4 MB", () => {
  assert.equal(receiptProblem({ name: "r.jpg", type: "image/jpeg", size: 200_000 }), null);
  assert.equal(receiptProblem({ name: "r.pdf", type: "application/pdf", size: 200_000 }), null);
  assert.match(receiptProblem({ name: "r.docx", type: "application/msword", size: 10 })!, /photo .* or a PDF/);
  assert.match(receiptProblem({ name: "big.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 })!, /larger than 4 MB/);
  assert.equal(receiptPath("abc", "application/pdf", 1), "refund/abc/1-receipt.pdf");
  assert.ok(isPdf(receiptPath("abc", "application/pdf")));
});

test("the payment receipt sits beside the claim's receipt, under its own name", () => {
  assert.equal(paymentProofPath("abc", "image/png", 1), "refund/abc/1-payment.png");
  assert.equal(paymentProofPath("abc", "application/pdf", 2), "refund/abc/2-payment.pdf");
  assert.notEqual(paymentProofPath("abc", "image/jpeg", 1), receiptPath("abc", "image/jpeg", 1));
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
