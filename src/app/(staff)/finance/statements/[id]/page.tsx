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
  }[];

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
                    <span>{c.description}</span>
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
