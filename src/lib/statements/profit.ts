/**
 * What D|R|P keeps from an owner statement, property by property (0077): the
 * management fee before its VAT (the VAT goes to the FTA, not to D|R|P) and
 * the booking adjustments taken off the owner's rent (an addition counts
 * against it). Shown only to the people company_settings.profit_viewer_ids lists.
 */
export type ProfitLine = {
  direction: string;
  category_code: string | null;
  unit_label: string | null;
  amount_aed: number | string;
  mgmt_fee_aed: number | string | null;
  mgmt_fee_vat_aed: number | string | null;
  deduction_aed: number | string | null;
};

export type PropertyProfit = {
  property: string;
  fee: number;
  feeVat: number;
  adjustments: number;
  profit: number;
};

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function statementProfit(lines: ProfitLine[]): { rows: PropertyProfit[]; total: PropertyProfit } {
  const by = new Map<string, PropertyProfit>();
  const row = (property: string) => {
    if (!by.has(property)) by.set(property, { property, fee: 0, feeVat: 0, adjustments: 0, profit: 0 });
    return by.get(property)!;
  };
  for (const l of lines) {
    const property = l.unit_label?.trim() || "Portfolio";
    if (l.direction === "income") {
      const r = row(property);
      r.fee += n(l.mgmt_fee_aed);
      r.feeVat += n(l.mgmt_fee_vat_aed);
      r.adjustments += n(l.deduction_aed);
    } else if (l.category_code === "EXP-MGMT-FEE") {
      // A fixed-fee agreement's fee line (its VAT is in vat_amount_aed, not D|R|P's)
      row(property).fee += n(l.amount_aed);
    }
  }
  const rows = [...by.values()]
    .map((r) => ({ ...r, fee: round2(r.fee), feeVat: round2(r.feeVat), adjustments: round2(r.adjustments), profit: round2(r.fee + r.adjustments) }))
    .filter((r) => r.fee || r.adjustments);
  const total = rows.reduce(
    (t, r) => ({ ...t, fee: round2(t.fee + r.fee), feeVat: round2(t.feeVat + r.feeVat), adjustments: round2(t.adjustments + r.adjustments), profit: round2(t.profit + r.profit) }),
    { property: "Total", fee: 0, feeVat: 0, adjustments: 0, profit: 0 }
  );
  return { rows, total };
}
