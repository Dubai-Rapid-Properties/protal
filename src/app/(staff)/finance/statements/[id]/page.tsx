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
import { canDeleteStatements } from "../../actions";

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
              canIssue={can(profile.role, "statements.issue")}
              canDelete={await canDeleteStatements(profile.email)}
            />
          }
        />
        <div className="mb-5">
          <StatementStatusBadge status={statement.status} />
        </div>
        {otherCharges.length > 0 && (
          <Card className="mb-5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Other fees</CardTitle>
              <p className="text-xs text-[var(--muted-foreground)]">
                Staff only. The owner&apos;s statement shows just the total, as Other charges.
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
