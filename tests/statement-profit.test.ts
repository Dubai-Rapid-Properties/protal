import { test } from "node:test";
import assert from "node:assert/strict";
import { statementProfit } from "@/lib/statements/profit";

const income = (unit: string, fee: number, vat: number, deduction: number | null) => ({
  direction: "income",
  category_code: "INC-BOOKING",
  unit_label: unit,
  amount_aed: 1000,
  mgmt_fee_aed: fee,
  mgmt_fee_vat_aed: vat,
  deduction_aed: deduction,
});

test("profit per property: fee before VAT plus adjustments; an addition counts against it", () => {
  const { rows, total } = statementProfit([
    income("Seven Palm - 1134", 655.29, 32.76, 1897.49),
    income("Seven Palm - 1134", 45.68, 2.28, 60),
    income("Zumurud Tower - 309", 100, 5, -200),
    { direction: "expense", category_code: "EXP-OTHER-FEES", unit_label: "Portfolio", amount_aed: 708.71, mgmt_fee_aed: null, mgmt_fee_vat_aed: null, deduction_aed: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.property, r.fee, r.adjustments, r.profit]), [
    ["Seven Palm - 1134", 700.97, 1957.49, 2658.46],
    ["Zumurud Tower - 309", 100, -200, -100],
  ]);
  assert.equal(total.profit, 2558.46);
  assert.equal(total.feeVat, 40.04);
});

test("a fixed-fee agreement's fee line counts as fee", () => {
  const { rows } = statementProfit([
    { direction: "expense", category_code: "EXP-MGMT-FEE", unit_label: "Cloud Tower - 406", amount_aed: 500, mgmt_fee_aed: null, mgmt_fee_vat_aed: null, deduction_aed: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.property, r.fee, r.profit]), [["Cloud Tower - 406", 500, 500]]);
});
