import { formatAED, formatPercent } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { Tables } from "@/lib/db/database.types";
import { Logo } from "@/components/layout/logo";

type Statement = Tables<"owner_statements">;
type Line = Tables<"owner_statement_lines">;
type Company = Tables<"company_settings"> | null;

/**
 * The owner statement as the owner receives it.
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
  const expenses = lines.filter((l) => l.direction === "expense");

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
    if (line.direction === "income") entry.income += Number(line.amount_aed);
    else entry.expense += Number(line.total_aed);
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

      {/* Summary */}
      <section className="mb-8 rounded-lg bg-neutral-50 p-4">
        <table className="tabular w-full text-sm">
          <tbody>
            <tr>
              <td className="py-1">Gross collected income</td>
              <td className="py-1 text-right">
                {formatAED(statement.gross_income_aed)}
              </td>
            </tr>
            <tr>
              <td className="py-1">Less: expenses (incl. VAT)</td>
              <td className="py-1 text-right">
                {/* Other fees (0055) are expenses to the owner, each listed below under its own name */}
                ({formatAED(Number(statement.total_expenses_aed) + Number(statement.other_fees_aed ?? 0))})
              </td>
            </tr>
            <tr>
              <td className="py-1">
                Less: management fee
                {statement.management_fee_pct != null ? ` (${Number(statement.management_fee_pct)}%)` : ""}
              </td>
              <td className="py-1 text-right">
                ({formatAED(statement.management_fee_aed)})
              </td>
            </tr>
            <tr>
              <td className="py-1">
                Less: VAT on management fee
                {company?.vat_rate ? ` (${formatPercent(company.vat_rate * 100, 0)})` : ""}
              </td>
              <td className="py-1 text-right">({formatAED(statement.vat_total_aed)})</td>
            </tr>
            {/* Other fees (0056): one sum for the owner, never what they were for */}
            {Number(statement.other_charges_aed ?? 0) > 0 && (
              <tr>
                <td className="py-1">Less: other charges</td>
                <td className="py-1 text-right">({formatAED(statement.other_charges_aed)})</td>
              </tr>
            )}
            <tr className="border-t-2 border-[#0F172A]">
              <td className="pt-2 text-base font-semibold">Net payable to owner</td>
              <td className="pt-2 text-right text-base font-semibold">
                {formatAED(statement.net_payout_aed)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Per-unit summary, only when it adds information */}
      {byUnit.size > 1 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            By unit
          </h2>
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-xs uppercase text-neutral-500">
                <th className="py-1.5">Unit</th>
                <th className="py-1.5 text-right">Income</th>
                <th className="py-1.5 text-right">Expenses</th>
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

      {/* Income detail */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Income
        </h2>
        {income.length === 0 ? (
          <p className="text-sm text-neutral-500">No income in this period.</p>
        ) : (
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-xs uppercase text-neutral-500">
                <th className="py-1.5">Date</th>
                <th className="py-1.5">Unit</th>
                <th className="py-1.5">Description</th>
                <th className="py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {income.map((line) => (
                <tr key={line.id} className="border-b border-neutral-100">
                  <td className="whitespace-nowrap py-1.5">
                    {formatDate(line.entry_date)}
                  </td>
                  <td className="py-1.5">{line.unit_label}</td>
                  <td className="py-1.5">{line.description}</td>
                  <td className="py-1.5 text-right">{formatAED(line.amount_aed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Expense detail, with VAT shown separately per line */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Expenses and fees
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
