import Link from "next/link";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCompanySettings, requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, EmptyState, Money } from "@/components/domain/shared";
import { StatementStatusBadge } from "@/components/domain/status-badge";
import { ExportButton } from "@/components/domain/export-button";
import { GenerateStatementDialog } from "./generate-dialog";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatPeriod } from "@/lib/dates";

export const metadata = { title: "Owner statements" };

export default async function StatementsPage() {
  const supabase = await createClient();

  const [profile, statementsResult, ownersResult, settings] = await Promise.all([
    requireCapability("statements.view"),
    supabase
      .from("owner_statements")
      .select("*, owners(id, full_name)")
      .order("period_start", { ascending: false }),
    supabase.from("owners").select("id, full_name").eq("is_active", true).order("full_name"),
    getCompanySettings(),
  ]);

  const statements = statementsResult.data ?? [];
  // Only used by the generate dialog, which only issuers see.
  const owners = can(profile.role, "statements.issue") ? (ownersResult.data ?? []) : [];

  const exportRows = statements.map((s) => ({
    Statement: s.statement_number,
    Owner: s.owners?.full_name ?? "",
    "Period start": s.period_start,
    "Period end": s.period_end,
    "Gross income (AED)": s.gross_income_aed,
    "Expenses (AED)": s.total_expenses_aed,
    "Management fee (AED)": s.management_fee_aed,
    "VAT (AED)": s.vat_total_aed,
    "Utility fees (AED)": s.other_fees_aed,
    "Net payout (AED)": s.net_payout_aed,
    Status: s.status,
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Finance", href: "/finance" }]}
        title="Owner statements"
        description="Itemised income, expenses, management fee and net payout per owner per period."
        actions={
          <>
            <ExportButton rows={exportRows} filename="drp-owner-statements" />
            {can(profile.role, "statements.issue") && (
              <GenerateStatementDialog owners={owners} vatRate={settings?.vat_rate} />
            )}
          </>
        }
      />

      {statements.length === 0 ? (
        <EmptyState
          title="No statements yet"
          description="Generate a statement for an owner and period. Every line is snapshotted from the ledger, so an issued statement never changes underneath you."
          icon={<FileText className="size-8" />}
          action={
            can(profile.role, "statements.issue") ? (
              <GenerateStatementDialog owners={owners} vatRate={settings?.vat_rate} />
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Statement</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="hidden lg:table-cell text-right">Income</TableHead>
                <TableHead className="hidden lg:table-cell text-right">Fee + VAT</TableHead>
                <TableHead className="text-right">Net payout</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.map((statement) => (
                <TableRow key={statement.id}>
                  <TableCell>
                    <Link
                      href={`/finance/statements/${statement.id}`}
                      className="font-medium hover:underline"
                    >
                      {statement.statement_number}
                    </Link>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {statement.issued_on
                        ? `Issued ${formatDate(statement.issued_on)}`
                        : "Draft"}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {statement.owners?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatPeriod(statement.period_start, statement.period_end)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-right">
                    <Money amount={statement.gross_income_aed} compact />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-right">
                    <Money
                      amount={
                        Number(statement.management_fee_aed) +
                        Number(statement.vat_total_aed)
                      }
                      compact
                      muted
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money amount={statement.net_payout_aed} />
                  </TableCell>
                  <TableCell className="text-right">
                    <StatementStatusBadge status={statement.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
