import { formatAED, formatPercent } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { Tables } from "@/lib/db/database.types";
import { Logo } from "@/components/layout/logo";

type Statement = Tables<"owner_statements">;
type Line = Tables<"owner_statement_lines">;
type Company = Tables<"company_settings"> | null;

// How the summary splits the expenses: utility fees as entered (0055) and the
// utility bills; maintenance and housekeeping. Anything else shows on its own.
const UTILITIES = new Set(["EXP-OTHER-FEES", "EXP-DEWA", "EXP-CHILLER"]);
const MAINTENANCE = new Set(["EXP-MAINT", "EXP-HOUSEKEEP"]);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="tabular mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

/**
 * The owner statement as the owner receives it: a summary page, then each
 * booking with the management fee on it, then the expenses (0057). Other fees
 * (0056) are for our own figures and never appear here.
 *
 * Rendered as a print-optimised A4 document rather than a generated PDF: the
 * browser's own print-to-PDF produces a smaller, searchable file, keeps Arabic
 * text selectable, and avoids shipping a PDF engine. The @media print rules in
 * globals.css strip the app chrome.
 */
export function StatementDocument({
  statement,
  lines,
  owner,
  company,
}: {
  statement: Statement;
  lines: Line[];
  owner: {
    full_name: string;
    email: string | null;
    phone: string | null;
    address_line: string | null;
    trn: string | null;
  } | null;
  company: Company;
}) {
  const income = lines.filter((l) => l.direction === "income");
  // Fee lines (fixed-fee agreements; before 0057 the whole fee) go with the
  // bookings, not the expenses.
  const feeLines = lines.filter((l) => l.category_code === "EXP-MGMT-FEE");
  const expenses = lines.filter((l) => l.direction === "expense" && l.category_code !== "EXP-MGMT-FEE");

  const sum = (rows: Line[], pick: (l: Line) => number | null) =>
    rows.reduce((total, l) => total + Number(pick(l) ?? 0), 0);
  const utilities = sum(expenses.filter((l) => UTILITIES.has(l.category_code ?? "")), (l) => l.total_aed);
  const maintenance = sum(expenses.filter((l) => MAINTENANCE.has(l.category_code ?? "")), (l) => l.total_aed);
  const totalExpenses = sum(expenses, (l) => l.total_aed);
  const otherExpenses = totalExpenses - utilities - maintenance;

  const grossIncome = Number(statement.gross_income_aed);
  const totalFee = Number(statement.management_fee_aed) + Number(statement.vat_total_aed);
  // Statements generated under 0056 took other charges off the payout; show
  // that so the summary still adds up. From 0057 they never reach the owner.
  const deducted = Math.round((grossIncome - totalExpenses - totalFee - Number(statement.net_payout_aed)) * 100) / 100;
  const vatLabel = company?.vat_rate ? formatPercent(company.vat_rate * 100, 0) : "5%";

  const bookingFee = (l: Line) =>
    l.mgmt_fee_aed == null ? null : Number(l.mgmt_fee_aed) + Number(l.mgmt_fee_vat_aed ?? 0);
  const feeNote = [
    statement.management_fee_pct != null ? `${Number(statement.management_fee_pct)}%` : null,
    Number(statement.vat_total_aed) > 0 ? `VAT ${vatLabel}` : null,
  ]
    .filter(Boolean)
    .join(" + ");

  const unitCount = new Set(lines.filter((l) => l.unit_id).map((l) => l.unit_id)).size;

  // Group income by unit so a multi-property owner can see each unit's
  // contribution without reading every line.
  const byUnit = new Map<string, { label: string; income: number; expense: number }>();
  for (const line of lines) {
    const key = line.unit_id ?? "portfolio";
    const entry = byUnit.get(key) ?? {
      label: line.unit_label ?? "Portfolio",
      income: 0,
      expense: 0,
    };
    if (line.direction === "income") {
      entry.income += Number(line.amount_aed);
      entry.expense += bookingFee(line) ?? 0;
    } else entry.expense += Number(line.total_aed);
    byUnit.set(key, entry);
  }

  return (
    <article className="print-page mx-auto max-w-[210mm] rounded-xl border border-[var(--border)] bg-white p-8 text-[#0F172A] shadow-sm">
      {/* Letterhead */}
      <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-[#C6A15B] pb-5">
        <div>
          <Logo imageClassName="w-32" />
          <p className="mt-3 text-sm font-medium">
            {company?.legal_name ?? "DRP Real Estate Brokers LLC"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            {company?.registered_address}
            {company?.trade_licence_number && (
              <>
                <br />
                Trade Licence {company.trade_licence_number}
              </>
            )}
            {company?.rera_broker_number && ` · RERA ${company.rera_broker_number}`}
            {company?.trn && (
              <>
                <br />
                TRN {company.trn}
              </>
            )}
            {(company?.phone || company?.email) && (
              <>
                <br />
                {[company.phone, company.email].filter(Boolean).join(" · ")}
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">Owner Statement</p>
          <p className="tabular mt-1 text-sm">{statement.statement_number}</p>
          <p className="tabular mt-2 text-xs text-neutral-600">
            Period {formatDate(statement.period_start)} –{" "}
            {formatDate(statement.period_end)}
          </p>
          {statement.issued_on && (
            <p className="tabular text-xs text-neutral-600">
              Issued {formatDate(statement.issued_on)}
            </p>
          )}
        </div>
      </header>

      {/* Owner */}
      <section className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Statement for
        </p>
        <p className="mt-1 font-medium">{owner?.full_name}</p>
        {owner?.address_line && (
          <p className="text-sm text-neutral-600">{owner.address_line}</p>
        )}
        <p className="text-sm text-neutral-600">
          {[owner?.email, owner?.phone].filter(Boolean).join(" · ")}
        </p>
        {owner?.trn && <p className="text-xs text-neutral-600">TRN {owner.trn}</p>}
      </section>

      {/* Page 1 - summary */}
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Bookings" value={String(statement.bookings_count ?? 0)} />
        <Stat label="Nights rented" value={String(statement.rented_nights ?? 0)} />
        <Stat
          label="Occupancy"
          value={statement.occupancy_pct == null ? "—" : formatPercent(statement.occupancy_pct, 1)}
        />
        <Stat label="Gross booking income" value={formatAED(grossIncome)} />
      </section>

      <section className="mb-8 rounded-lg bg-neutral-50 p-4">
        <table className="tabular w-full text-sm">
          <tbody>
            <tr>
              <td className="py-1 font-medium">Total gross booking income</td>
              <td className="py-1 text-right font-medium">{formatAED(grossIncome)}</td>
            </tr>
            <tr>
              <td className="py-1">Less: total expenses</td>
              <td className="py-1 text-right">({formatAED(totalExpenses)})</td>
            </tr>
            <tr className="text-neutral-600">
              <td className="py-0.5 pl-4 text-xs">Utilities</td>
              <td className="py-0.5 text-right text-xs">{formatAED(utilities)}</td>
            </tr>
            <tr className="text-neutral-600">
              <td className="py-0.5 pl-4 text-xs">Maintenance</td>
              <td className="py-0.5 text-right text-xs">{formatAED(maintenance)}</td>
            </tr>
            {Math.abs(otherExpenses) >= 0.005 && (
              <tr className="text-neutral-600">
                <td className="py-0.5 pl-4 text-xs">Other expenses</td>
                <td className="py-0.5 text-right text-xs">{formatAED(otherExpenses)}</td>
              </tr>
            )}
            <tr>
              <td className="py-1">
                Less: total management fee{feeNote ? ` (${feeNote})` : ""}
              </td>
              <td className="py-1 text-right">({formatAED(totalFee)})</td>
            </tr>
            {Number(statement.vat_total_aed) > 0 && (
              <tr className="text-neutral-600">
                <td className="py-0.5 pl-4 text-xs">
                  Fee {formatAED(statement.management_fee_aed)} + VAT {formatAED(statement.vat_total_aed)}
                </td>
                <td />
              </tr>
            )}
            {deducted >= 0.01 && (
              <tr>
                <td className="py-1">Less: other charges</td>
                <td className="py-1 text-right">({formatAED(deducted)})</td>
              </tr>
            )}
            <tr className="border-t-2 border-[#0F172A]">
              <td className="pt-2 text-base font-semibold">Net income payable to owner</td>
              <td className="pt-2 text-right text-base font-semibold">
                {formatAED(statement.net_payout_aed)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Per-unit summary, only when it adds information */}
      {unitCount > 1 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            By unit
          </h2>
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-xs uppercase text-neutral-500">
                <th className="py-1.5">Unit</th>
                <th className="py-1.5 text-right">Income</th>
                <th className="py-1.5 text-right">Expenses and fees</th>
                <th className="py-1.5 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {[...byUnit.values()].map((unit) => (
                <tr key={unit.label} className="border-b border-neutral-100">
                  <td className="py-1.5">{unit.label}</td>
                  <td className="py-1.5 text-right">{formatAED(unit.income)}</td>
                  <td className="py-1.5 text-right">{formatAED(unit.expense)}</td>
                  <td className="py-1.5 text-right font-medium">
                    {formatAED(unit.income - unit.expense)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Page 2 - booking breakdown; its totals are the summary's */}
      <section className="mb-6 break-before-page">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Booking breakdown
        </h2>
        {income.length === 0 && feeLines.length === 0 ? (
          <p className="text-sm text-neutral-500">No bookings in this period.</p>
        ) : (
          <table className="tabular w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-xs uppercase text-neutral-500">
                <th className="py-1.5 pr-2">Guest</th>
                <th className="py-1.5 pr-2">Check-in</th>
                <th className="py-1.5 pr-2">Check-out</th>
                <th className="py-1.5 pr-2 text-right">Nights</th>
                <th className="py-1.5 pr-2 text-right">Rent</th>
                <th className="py-1.5 pr-2 text-right">Mgmt fee</th>
                <th className="py-1.5 text-right">Owner net</th>
              </tr>
            </thead>
            <tbody>
              {income.map((line) => {
                const fee = bookingFee(line);
                return (
                  <tr key={line.id} className="border-b border-neutral-100 align-top">
                    <td className="py-1.5 pr-2">
                      {line.guest_name || line.description}
                      {unitCount > 1 && (
                        <span className="block text-xs text-neutral-500">{line.unit_label}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2">
                      {line.check_in ? formatDate(line.check_in) : "—"}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2">
                      {line.check_out ? formatDate(line.check_out) : formatDate(line.entry_date)}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{line.nights ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right">{formatAED(line.amount_aed)}</td>
                    <td className="py-1.5 pr-2 text-right">{fee == null ? "—" : `(${formatAED(fee)})`}</td>
                    <td className="py-1.5 text-right">{formatAED(Number(line.amount_aed) - (fee ?? 0))}</td>
                  </tr>
                );
              })}
              {feeLines.map((line) => (
                <tr key={line.id} className="border-b border-neutral-100">
                  <td className="py-1.5 pr-2" colSpan={5}>
                    {line.description}
                    {unitCount > 1 && line.unit_id && (
                      <span className="text-xs text-neutral-500"> · {line.unit_label}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right">({formatAED(line.total_aed)})</td>
                  <td className="py-1.5 text-right">{formatAED(-Number(line.total_aed))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[#0F172A] font-semibold">
                <td className="pt-2 pr-2" colSpan={3}>
                  Total
                </td>
                <td className="pt-2 pr-2 text-right">{statement.rented_nights ?? 0}</td>
                <td className="pt-2 pr-2 text-right">{formatAED(grossIncome)}</td>
                <td className="pt-2 pr-2 text-right">({formatAED(totalFee)})</td>
                <td className="pt-2 text-right">{formatAED(grossIncome - totalFee)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {Number(statement.vat_total_aed) > 0 && (
          <p className="mt-2 text-xs text-neutral-500">Management fee shown including VAT at {vatLabel}.</p>
        )}
      </section>

      {/* Expense detail, with VAT shown separately per line */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Expenses
        </h2>
        {expenses.length === 0 ? (
          <p className="text-sm text-neutral-500">No expenses in this period.</p>
        ) : (
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-xs uppercase text-neutral-500">
                <th className="py-1.5">Date</th>
                <th className="py-1.5">Unit</th>
                <th className="py-1.5">Description</th>
                <th className="py-1.5 text-right">Net</th>
                <th className="py-1.5 text-right">VAT</th>
                <th className="py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((line) => (
                <tr key={line.id} className="border-b border-neutral-100">
                  <td className="whitespace-nowrap py-1.5">
                    {formatDate(line.entry_date)}
                  </td>
                  <td className="py-1.5">{line.unit_label}</td>
                  <td className="py-1.5">{line.description}</td>
                  <td className="py-1.5 text-right">{formatAED(line.amount_aed)}</td>
                  <td className="py-1.5 text-right">
                    {Number(line.vat_amount_aed) === 0
                      ? "—"
                      : formatAED(line.vat_amount_aed)}
                  </td>
                  <td className="py-1.5 text-right">{formatAED(line.total_aed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="border-t border-neutral-200 pt-4 text-xs leading-relaxed text-neutral-500">
        <p>
          All amounts are in UAE Dirhams (AED). VAT is applied at{" "}
          {company?.vat_rate ? formatPercent(company.vat_rate * 100, 0) : "5%"} on
          taxable supplies only. Long-term residential rent is exempt from VAT under
          UAE Federal Decree-Law No. 8 of 2017.
        </p>
        {statement.notes && <p className="mt-2">{statement.notes}</p>}
        <p className="mt-2">
          Queries on this statement should be raised with your property manager within
          14 days of issue.
        </p>
      </footer>
    </article>
  );
}
