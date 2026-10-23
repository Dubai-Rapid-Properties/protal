import { cache } from "react";
import { env } from "@/lib/env";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  PageHeader,
  Field,
  FieldGrid,
  Money,
  EmptyState,
  Callout,
} from "@/components/domain/shared";
import {
  UnitStatusBadge,
  StatementStatusBadge,
} from "@/components/domain/status-badge";
import { DocumentList } from "@/components/domain/document-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatPeriod } from "@/lib/dates";
import { formatAED, formatPercent } from "@/lib/money";
import { PortalAccess } from "./portal-access";
import { AgreementDialog, EndAgreementButton } from "./agreement-dialog";
import { Button } from "@/components/ui/button";
import { RecordActions } from "@/components/domain/record-actions";
import { archiveOwner, deleteOwner, restoreOwner } from "../actions";

/** Shared by the page and its metadata, so the owner is fetched once. */
const getOwner = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("owners").select("*").eq("id", id).maybeSingle();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getOwner(id);
  return { title: data?.full_name ?? "Owner" };
}

export default async function OwnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // One batch: every related query is keyed by the owner id from the URL.
  const [
    profile,
    owner,
    unitsResult,
    statementsResult,
    documentsResult,
    bankResult,
    agreementsResult,
    loginsResult,
  ] = await Promise.all([
    requireCapability("owners.view"),
    getOwner(id),
    supabase
      .from("unit_ownerships")
      .select(
        "ownership_pct, is_primary_contact, units(id, unit_number, status, operating_mode, target_annual_rent_aed, properties(name))"
      )
      .eq("owner_id", id)
      .is("end_date", null),
    supabase
      .from("owner_statements")
      .select("*")
      .eq("owner_id", id)
      .order("period_start", { ascending: false })
      .limit(12),
    supabase
      .from("documents")
      .select("*")
      .eq("owner_id", id)
      .order("created_at", { ascending: false }),
    // Gated on the role below; RLS also withholds it from non-finance roles.
    supabase.from("owner_bank_accounts").select("*").eq("owner_id", id).eq("is_active", true),
    supabase
      .from("management_agreements")
      .select("*, units(unit_number, properties(name))")
      .eq("owner_id", id)
      .eq("is_active", true),
    supabase
      .from("owner_users")
      .select("profile_id, profiles(email, last_login_at)")
      .eq("owner_id", id),
  ]);

  if (!owner) notFound();

  const showBank = can(profile.role, "owners.bank_details");
  const ownedUnits = unitsResult.data ?? [];
  const statements = statementsResult.data ?? [];
  const documents = documentsResult.data ?? [];
  const bankAccounts = showBank ? (bankResult.data ?? []) : [];
  const agreements = agreementsResult.data ?? [];
  const logins = (loginsResult.data ?? []).map((row) => ({
    profileId: row.profile_id,
    email: row.profiles?.email ?? null,
    lastLoginAt: row.profiles?.last_login_at ?? null,
  }));

  const ytdPayout = statements
    .filter((s) => new Date(s.period_start).getFullYear() === new Date().getFullYear())
    .reduce((sum, s) => sum + Number(s.net_payout_aed), 0);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Owners", href: "/owners" }]}
        title={owner.full_name}
        description={[
          owner.is_company ? "Company" : "Individual",
          owner.nationality,
          `${ownedUnits.length} unit${ownedUnits.length === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          can(profile.role, "owners.manage") ? (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href={`/owners/${owner.id}/edit`}>
                  <Pencil className="size-4" />
                  Edit
                </Link>
              </Button>
              <RecordActions
                noun="owner"
                idName="ownerId"
                id={owner.id}
                isActive={owner.is_active}
                archive={archiveOwner}
                restore={restoreOwner}
                remove={profile.role === "super_admin" ? deleteOwner : undefined}
              />
            </>
          ) : undefined
        }
      />

      {!owner.is_active && (
        <div className="mb-5">
          <Callout tone="warning" title="This owner is archived">
            They are hidden from the owners list and cannot be chosen for units. Their
            statements and history are kept.
          </Callout>
        </div>
      )}

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="units">Units ({ownedUnits.length})</TabsTrigger>
          <TabsTrigger value="statements">Statements ({statements.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Contact</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGrid columns={2}>
                  <Field label="Email">{owner.email ?? "—"}</Field>
                  <Field label="Phone">{owner.phone ?? "—"}</Field>
                  <Field label="WhatsApp">{owner.whatsapp ?? owner.phone ?? "—"}</Field>
                  <Field label="Preferred channel">{owner.preferred_channel}</Field>
                  <Field label="Nationality">{owner.nationality ?? "—"}</Field>
                  <Field label="Country of residence">
                    {owner.country_of_residence ?? "—"}
                  </Field>
                  <Field label="Address" className="sm:col-span-2">
                    {owner.address_line ?? "—"}
                  </Field>
                </FieldGrid>
              </CardContent>
            </Card>

            <PortalAccess
              ownerId={owner.id}
              defaultEmail={owner.email}
              logins={logins}
              canManage={can(profile.role, "users.manage")}
              passwords={env.ownerPasswords}
              canEmail={env.messaging.emailProvider === "resend" && Boolean(env.messaging.resendApiKey)}
              staffEmail={profile.email ?? ""}
            />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Identification</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGrid columns={2}>
                  <Field label="Emirates ID">{owner.emirates_id ?? "—"}</Field>
                  <Field label="Emirates ID expiry">
                    {formatDate(owner.emirates_id_expiry)}
                  </Field>
                  <Field label="Passport">{owner.passport_number ?? "—"}</Field>
                  <Field label="Passport expiry">
                    {formatDate(owner.passport_expiry)}
                  </Field>
                  <Field label="TRN">{owner.trn ?? "Not VAT registered"}</Field>
                  {owner.is_company && (
                    <Field label="Trade licence">
                      {owner.company_trade_licence ?? "—"}
                    </Field>
                  )}
                </FieldGrid>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock className="size-4" />
                  Payout details
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!showBank ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Bank details are restricted to finance and administrators.
                  </p>
                ) : bankAccounts.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No bank account on file. Payouts cannot be processed until one is
                    recorded.
                  </p>
                ) : (
                  bankAccounts.map((account) => (
                    <FieldGrid key={account.id} columns={2}>
                      <Field label="Account holder">{account.account_holder}</Field>
                      <Field label="Bank">{account.bank_name}</Field>
                      <Field label="IBAN">
                        <span className="tabular">{account.iban}</span>
                      </Field>
                      <Field label="Currency">{account.currency}</Field>
                    </FieldGrid>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="text-base">Management agreements</CardTitle>
                {can(profile.role, "owners.manage") && (
                  <AgreementDialog
                    ownerId={id}
                    units={ownedUnits.flatMap((row) =>
                      row.units
                        ? [
                            {
                              id: row.units.id,
                              label: `${row.units.properties?.name ?? "Unit"} · ${row.units.unit_number}`,
                              mode:
                                row.units.operating_mode === "short_term" || row.units.operating_mode === "both"
                                  ? row.units.operating_mode
                                  : ("long_term" as const),
                            },
                          ]
                        : []
                    )}
                  />
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {agreements.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No active agreement. Owner statements will not charge a management
                    fee until one is recorded. Filing the signed copy under Documents
                    does not record it: use Add agreement.
                  </p>
                ) : (
                  agreements.map((agreement) => (
                    <div
                      key={agreement.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {agreement.units?.properties?.name} ·{" "}
                          {agreement.units?.unit_number}
                        </p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {agreement.agreement_number && `${agreement.agreement_number} · `}
                          {formatDate(agreement.start_date)} –{" "}
                          {formatDate(agreement.end_date)}
                          {agreement.auto_renew && " · auto-renews"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="brand">
                          {agreement.commission_pct
                            ? `${formatPercent(agreement.commission_pct)}`
                            : `Fixed fee ${formatAED(agreement.fixed_fee_aed)}`}
                        </Badge>
                        {can(profile.role, "owners.manage") && (
                          <EndAgreementButton agreementId={agreement.id} ownerId={id} />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="units">
          <Card>
            <CardContent className="p-0">
              {ownedUnits.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No units linked"
                    description="Link this owner to the units they hold, with the ownership percentage and title deed reference."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      <TableHead className="text-right">Target rent</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownedUnits.map((row) => (
                      <TableRow key={row.units?.id}>
                        <TableCell>
                          <Link
                            href={`/units/${row.units?.id}`}
                            className="font-medium hover:underline"
                          >
                            {row.units?.properties?.name} · {row.units?.unit_number}
                          </Link>
                          {row.is_primary_contact && (
                            <Badge variant="muted" className="ml-2">
                              Primary contact
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right text-sm">
                          {formatPercent(row.ownership_pct)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Money amount={row.units?.target_annual_rent_aed} compact muted />
                        </TableCell>
                        <TableCell className="text-right">
                          {row.units?.status && (
                            <UnitStatusBadge status={row.units.status} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statements">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Statements
                <span className="ml-2 text-sm font-normal text-[var(--muted-foreground)]">
                  paid out year to date: <Money amount={ytdPayout} />
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {statements.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No statements"
                    description="Generate a statement from the finance module once income has been collected."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Statement</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="hidden md:table-cell text-right">
                        Income
                      </TableHead>
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
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatPeriod(statement.period_start, statement.period_end)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right">
                          <Money amount={statement.gross_income_aed} compact />
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <DocumentList
            documents={documents}
            entityKind="owner"
            entityId={id}
            ownerId={id}
            canUpload={can(profile.role, "documents.upload")}
            canDelete={profile.role === "super_admin"}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
