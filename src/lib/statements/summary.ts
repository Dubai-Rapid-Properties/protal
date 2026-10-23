/**
 * The owner statement's figures, as the printed statement and the email to
 * the owner show them (0057). The database computed every total; this only
 * groups the lines and reconciles them with those totals.
 */

export interface SummaryStatement {
  gross_income_aed: number;
  management_fee_aed: number;
  vat_total_aed: number;
  net_payout_aed: number;
}

export interface SummaryLine {
  direction: "income" | "expense";
  category_code: string | null;
  total_aed: number;
  amount_aed: number;
  mgmt_fee_aed: number | null;
  mgmt_fee_vat_aed: number | null;
}

// How the summary splits the expenses: utility fees as entered (0055) and the
// utility bills; maintenance and housekeeping. Anything else shows on its own.
const UTILITIES = new Set(["EXP-OTHER-FEES", "EXP-DEWA", "EXP-CHILLER"]);
const MAINTENANCE = new Set(["EXP-MAINT", "EXP-HOUSEKEEP"]);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A booking line's management fee with its VAT; null on statements from before 0057. */
export const bookingFee = (l: Pick<SummaryLine, "mgmt_fee_aed" | "mgmt_fee_vat_aed">) =>
  l.mgmt_fee_aed == null ? null : Number(l.mgmt_fee_aed) + Number(l.mgmt_fee_vat_aed ?? 0);

/**
 * A booking's dates as the statement shows them: only the part inside the
 * statement period. A stay that began before the period starts on its first
 * day; one that runs on past it ends on its last day (YYYY-MM-DD strings).
 */
export function stayInPeriod(
  l: { check_in: string | null; check_out: string | null; entry_date: string },
  periodStart: string,
  periodEnd: string
): { checkIn: string | null; checkOut: string } {
  const checkIn = l.check_in && l.check_in < periodStart ? periodStart : l.check_in;
  const checkOut = l.check_out ? (l.check_out > periodEnd ? periodEnd : l.check_out) : l.entry_date;
  return { checkIn, checkOut };
}

export function statementSummary<L extends SummaryLine>(statement: SummaryStatement, lines: L[]) {
  const income = lines.filter((l) => l.direction === "income");
  // Fee lines (fixed-fee agreements; before 0057 the whole fee) go with the
  // bookings, not the expenses.
  const feeLines = lines.filter((l) => l.category_code === "EXP-MGMT-FEE");
  const expenses = lines.filter((l) => l.direction === "expense" && l.category_code !== "EXP-MGMT-FEE");

  const sum = (rows: L[]) => round2(rows.reduce((total, l) => total + Number(l.total_aed), 0));
  const utilities = sum(expenses.filter((l) => UTILITIES.has(l.category_code ?? "")));
  const maintenance = sum(expenses.filter((l) => MAINTENANCE.has(l.category_code ?? "")));
  const totalExpenses = sum(expenses);

  const grossIncome = Number(statement.gross_income_aed);
  const totalFee = round2(Number(statement.management_fee_aed) + Number(statement.vat_total_aed));
  // Statements generated under 0056 took other charges off the payout; show
  // that so the summary still adds up. From 0057 they never reach the owner.
  const deducted = round2(grossIncome - totalExpenses - totalFee - Number(statement.net_payout_aed));

  return {
    income,
    feeLines,
    expenses,
    utilities,
    maintenance,
    otherExpenses: round2(totalExpenses - utilities - maintenance),
    totalExpenses,
    grossIncome,
    totalFee,
    deducted: deducted >= 0.01 ? deducted : 0,
  };
}
