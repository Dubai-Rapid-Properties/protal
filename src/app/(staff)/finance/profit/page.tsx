import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader, EmptyState, Money } from "@/components/domain/shared";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPeriod } from "@/lib/dates";
import { statementProfit, type ProfitLine } from "@/lib/statements/profit";

export const metadata = { title: "Company profit" };

/**
 * What D|R|P keeps from each owner statement, property by property (0077):
 * the management fee before VAT plus the booking adjustments. Only the people
 * in company_settings.profit_viewer_ids reach this page.
 */
export default async function CompanyProfitPage() {
  await requireCapability("statements.view");
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_see_company_profit");
  if (allowed !== true) notFound();

  const { data: statements } = await supabase
    .from("owner_statements")
    .select("id, statement_number, period_start, period_end, status, owners(full_name)")
    .neq("status", "void")
    .order("period_end", { ascending: false })
    .limit(200);
  const ids = (statements ?? []).map((s) => s.id);
  const { data: lines } = ids.length
    ? await supabase
        .from("owner_statement_lines")
        .select("statement_id, direction, category_code, unit_label, amount_aed, mgmt_fee_aed, mgmt_fee_vat_aed, deduction_aed")
        .in("statement_id", ids)
    : { data: [] };

  const byStatement = new Map<string, ProfitLine[]>();
  for (const l of lines ?? []) byStatement.set(l.statement_id, [...(byStatement.get(l.statement_id) ?? []), l]);

  const rows = (statements ?? []).flatMap((s) =>
    statementProfit(byStatement.get(s.id) ?? []).rows.map((r) => ({ statement: s, ...r }))
  );
  // Totals per statement period ("16 Oct - 15 Nov 2026"), newest first.
  const periods = new Map<string, { fee: number; adjustments: number; profit: number }>();
  for (const r of rows) {
    const key = formatPeriod(r.statement.period_start, r.statement.period_end);
    const t = periods.get(key) ?? { fee: 0, adjustments: 0, profit: 0 };
    periods.set(key, { fee: t.fee + r.fee, adjustments: t.adjustments + r.adjustments, profit: t.profit + r.profit });
  }

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Finance", href: "/finance" }, { label: "Owner statements", href: "/finance/statements" }]}
        title="Company profit"
        description="What D|R|P keeps from each owner statement, per property: the management fee before VAT plus the booking adjustments. Only you can see this page."
      />
      {rows.length === 0 ? (
        <EmptyState title="No profit to show yet" description="It appears here as statements are generated." />
      ) : (
        <div className="space-y-5">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Mgmt fee</TableHead>
                  <TableHead className="text-right">Adjustments</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...periods].map(([period, t]) => (
                  <TableRow key={period}>
                    <TableCell className="font-medium">{period}</TableCell>
                    <TableCell className="text-right"><Money amount={t.fee} /></TableCell>
                    <TableCell className="text-right"><Money amount={t.adjustments} /></TableCell>
                    <TableCell className="text-right font-medium"><Money amount={t.profit} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Statement</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Mgmt fee</TableHead>
                  <TableHead className="text-right">Adjustments</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.statement.id}-${r.property}`}>
                    <TableCell>
                      <Link href={`/finance/statements/${r.statement.id}`} className="font-medium hover:underline">
                        {r.statement.statement_number}
                      </Link>
                    </TableCell>
                    <TableCell>{r.statement.owners?.full_name}</TableCell>
                    <TableCell>{r.property}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatPeriod(r.statement.period_start, r.statement.period_end)}</TableCell>
                    <TableCell className="text-right"><Money amount={r.fee} /></TableCell>
                    <TableCell className="text-right"><Money amount={r.adjustments} /></TableCell>
                    <TableCell className="text-right font-medium"><Money amount={r.profit} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
