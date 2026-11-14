import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability, getCompanySettings } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Money, PageHeader } from "@/components/domain/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatementStatusBadge } from "@/components/domain/status-badge";
import { StatementDocument } from "@/components/domain/statement-document";
import { StatementActions } from "./statement-actions";
import { GenerateStatementDialog, type Draft } from "../generate-dialog";
import { canApproveStatements, canDeleteStatements } from "../../actions";
import { formatDateTime } from "@/lib/dates";

/** Shared by the page and its metadata, so the statement is fetched once. */
const getStatement = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("owner_statements")
    .select("*, owners(id, full_name, email, phone, address_line, trn)")
    .eq("id", id)
    .maybeSingle();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getStatement(id);
  return { title: data?.statement_number ?? "Statement" };
}

export default async function StatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [profile, settings, statement, { data: lines }] = await Promise.all([
    requireCapability("statements.view"),
    getCompanySettings(),
    getStatement(id),
    supabase
      .from("owner_statement_lines")
      .select("*")
      .eq("statement_id", id)
      .order("sort_order"),
  ]);

  if (!statement) notFound();
  const canApprove = await canApproveStatements();
  const otherCharges = (Array.isArray(statement.other_charges) ? statement.other_charges : []) as {
    description: string;
    amount: number;
    pct?: number;
  }[];
  // Booking deductions (0061): the owner sees only the rent after them.
  const deducted = (lines ?? []).filter((l) => l.deduction_aed != null);
  // The booking's own fees taken off with it (0073): cleaning, guest fee, others.
  const feesOn = (l: { deduction_items: unknown }) =>
    (Array.isArray(l.deduction_items) ? l.deduction_items : []) as { description: string; amount: number }[];

  // A draft not waiting for the approver can be edited (0071): the dialog opens on its figures.
  const editable = statement.status === "draft" && !statement.submitted_at && can(profile.role, "statements.issue");
  const editDraft: Draft | null = editable
    ? {
        ownerId: statement.owner_id,
        periodStart: statement.period_start,
        periodEnd: statement.period_end,
        feePct: statement.management_fee_pct != null ? String(Number(statement.management_fee_pct)) : "",
        feeVat: statement.fee_vat_applied ?? true,
        utilities: (lines ?? [])
          .filter((l) => l.category_code === "EXP-OTHER-FEES" && !l.ledger_entry_id)
          .map((l, key) => ({ key, description: l.description, amount: String(Number(l.amount_aed)), unit: "aed" as const })),
        // Entered on the statement (no ledger line), on its Maintenance row (0072).
        maintenance: (lines ?? [])
          .filter((l) => l.category_code === "EXP-MAINT" && !l.ledger_entry_id)
          .map((l, key) => ({ key, description: l.description, amount: String(Number(l.amount_aed)), unit: "aed" as const })),
        others: otherCharges.map((c, key) =>
          c.pct != null
            ? { key, description: c.description, amount: String(Number(c.pct)), unit: "pct" as const }
            : { key, description: c.description, amount: String(Number(c.amount)), unit: "aed" as const }
        ),
        cuts: Object.fromEntries(
          deducted
            .filter((l) => l.ledger_entry_id)
            .map((l) => {
              const fees = feesOn(l);
              const named = (name: string) => fees.find((f) => f.description === name);
              const others = fees.filter((f) => f !== named("Cleaning fee") && f !== named("Guest fee"));
              // The adjustment itself: what is left once the fees are taken out.
              const base = Math.round((Number(l.deduction_aed) - fees.reduce((sum, f) => sum + Number(f.amount), 0)) * 100) / 100;
              return [
                l.ledger_entry_id as string,
                {
                  value: base === 0 ? "" : String(Math.abs(base)),
                  unit: "aed" as const,
                  add: base < 0,
                  cleaning: named("Cleaning fee") ? String(Number(named("Cleaning fee")!.amount)) : "",
                  guest: named("Guest fee") ? String(Number(named("Guest fee")!.amount)) : "",
                  fees: others.map((f, key) => ({ key, description: f.description, amount: String(Number(f.amount)) })),
                },
              ];
            })
        ),
      }
    : null;

  return (
    <>
      <div className="no-print">
        <PageHeader
          breadcrumb={[
            { label: "Finance", href: "/finance" },
            { label: "Statements", href: "/finance/statements" },
          ]}
          title={statement.statement_number}
          description={statement.owners?.full_name ?? undefined}
          actions={
            <StatementActions
              statementId={id}
              status={statement.status}
              submitted={!!statement.submitted_at}
              ownerEmail={statement.owners?.email ?? null}
              canIssue={can(profile.role, "statements.issue")}
              canApprove={canApprove}
              canDelete={await canDeleteStatements(profile.email)}
              editButton={
                editDraft && statement.owners ? (
                  <GenerateStatementDialog
                    owners={[{ id: statement.owners.id, full_name: statement.owners.full_name }]}
                    vatRate={settings?.vat_rate}
                    edit={{ statementId: id, draft: editDraft }}
                  />
                ) : null
              }
            />
          }
        />
        <div className="mb-5">
          <StatementStatusBadge status={statement.status} submitted={!!statement.submitted_at} />
        </div>
        {statement.status === "draft" && statement.submitted_at && (
          <p className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
            {canApprove
              ? `Waiting for your approval. Check the statement below, then approve it to email it to ${statement.owners?.email ?? "the owner (no email on file)"}.`
              : `Sent for approval ${formatDateTime(statement.submitted_at)}. The approver emails it to the owner on approving.`}
          </p>
        )}
        {statement.status === "draft" && !statement.submitted_at && statement.return_note && (
          <p className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
            Sent back by the approver: {statement.return_note}
          </p>
        )}
        {statement.sent_at && (
          <p className="mb-5 text-sm text-[var(--muted-foreground)]">
            Approved and sent to {statement.sent_to} on {formatDateTime(statement.sent_at)}.
          </p>
        )}
        {otherCharges.length > 0 && (
          <Card className="mb-5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Other fees</CardTitle>
              <p className="text-xs text-[var(--muted-foreground)]">
                Staff only, for our own figures: never on the owner&apos;s statement.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {otherCharges.map((c, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span>
                      {c.description}
                      {c.pct != null && (
                        <span className="text-[var(--muted-foreground)]"> ({Number(c.pct)}% of booking income)</span>
                      )}
                    </span>
                    <Money amount={c.amount} />
                  </li>
                ))}
                <li className="flex justify-between gap-4 border-t border-[var(--border)] pt-1 font-medium">
                  <span>Total</span>
                  <Money amount={statement.other_charges_aed} />
                </li>
              </ul>
            </CardContent>
          </Card>
        )}
        {deducted.length > 0 && (
          <Card className="mb-5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Booking adjustments</CardTitle>
              <p className="text-xs text-[var(--muted-foreground)]">
                Staff only. Taken off (or added to) these bookings&apos; rent; the owner&apos;s statement shows the rent after them.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {deducted.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-x-4">
                    <span>
                      {l.guest_name || l.description}
                      {feesOn(l).length > 0 && (
                        <span className="block text-xs text-[var(--muted-foreground)]">
                          {feesOn(l)
                            .map((f) => `${f.description} ${Number(f.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-[var(--muted-foreground)]">
                      <Money amount={l.original_amount_aed} /> {Number(l.deduction_aed) < 0 ? "+" : "−"}{" "}
                      <Money amount={Math.abs(Number(l.deduction_aed))} /> ={" "}
                      <span className="font-medium text-[var(--foreground)]">
                        <Money amount={l.amount_aed} />
                      </span>
                    </span>
                  </li>
                ))}
                <li className="flex justify-between gap-4 border-t border-[var(--border)] pt-1 font-medium">
                  <span>Total adjustment (− off, + on)</span>
                  <Money amount={deducted.reduce((sum, l) => sum + Number(l.deduction_aed), 0)} />
                </li>
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <StatementDocument
        statement={statement}
        lines={lines ?? []}
        owner={statement.owners}
        company={settings}
      />
    </>
  );
}
