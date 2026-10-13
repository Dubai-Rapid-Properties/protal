import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, FileSignature, Globe, Pencil, Plus, ShieldAlert, Wrench } from "lucide-react";
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
  OperatingModeBadge,
  EjariBadge,
  PermitBadge,
  LeaseStatusBadge,
  ComplianceBadge,
} from "@/components/domain/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ROW_LINK,
  ROW_CLICKABLE,
} from "@/components/ui/table";
import { DocumentList } from "@/components/domain/document-list";
import { formatDate } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { UNIT_KIND, FURNISHING, COMPLIANCE_KIND } from "@/lib/labels";
import { RecordActions } from "@/components/domain/record-actions";
import { archiveUnit, deleteUnit, restoreUnit } from "../actions";
import { PermitDialog } from "./permit-dialog";
import { BlockDatesDialog, BlockNoteDialog, RemoveBlockButton } from "./block-dates";
import { ChannelSync, type ChannelStay } from "./channel-sync";
import { env } from "@/lib/env";
import { BookingCalendar } from "@/components/domain/booking-calendar";
import { dubaiToday, monthGrid, parseMonth, rangesOverlap, uncoveredRanges } from "@/lib/calendar";

/** Shared by the page and its metadata, so the overview row is fetched once. */
const getOverview = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("v_units_overview").select("*").eq("id", id).maybeSingle();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getOverview(id);
  return {
    title: data ? `${data.property_name} ${data.unit_number}` : "Unit",
  };
}

export default async function UnitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const { id } = await params;
  const { tab, month: monthParam } = await searchParams;
  const month = parseMonth(monthParam);
  const grid = monthGrid(month);
  const gridStart = grid[0][0];
  const gridEnd = grid[grid.length - 1][6];
  const supabase = await createClient();

  // Everything in one batch: all of it is keyed by the unit id from the URL,
  // and RLS guards each query, so nothing needs to wait for the profile or
  // the unit row. From Dubai to the database region each extra sequential
  // step costs a full round trip.
  const [
    profile,
    { data: unit },
    overview,
    ownershipResult,
    leasesResult,
    permitResult,
    complianceResult,
    documentsResult,
    agreementResult,
    staysResult,
    blocksResult,
    flaggedResult,
    clashResult,
    linkResult,
  ] = await Promise.all([
    requireCapability("units.view"),
    supabase
      .from("units")
      .select("*, properties(id, name, kind, community_id, communities(name, emirate))")
      .eq("id", id)
      .maybeSingle(),
    getOverview(id),
    supabase
      .from("unit_ownerships")
      .select("*, owners(id, full_name, email, phone, is_company)")
      .eq("unit_id", id)
      .is("end_date", null),
    supabase
      .from("leases")
      .select("*, tenants(id, full_name, email, phone)")
      .eq("unit_id", id)
      .order("start_date", { ascending: false }),
    supabase
      .from("holiday_home_permits")
      .select("*")
      .eq("unit_id", id)
      .order("expires_on", { ascending: false }),
    supabase
      .from("v_compliance_status")
      .select("*")
      .eq("unit_id", id)
      .neq("severity", "ok")
      .order("days_remaining"),
    supabase
      .from("documents")
      .select("*")
      .eq("unit_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("management_agreements")
      .select("*, owners(full_name)")
      .eq("unit_id", id)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select("id, check_in, check_out, channel, status, guests(full_name)")
      .eq("unit_id", id)
      .in("status", ["inquiry", "tentative", "confirmed", "checked_in", "checked_out"])
      .lte("check_in", gridEnd)
      .gt("check_out", gridStart),
    supabase
      .from("availability_blocks")
      .select("id, start_date, end_date, reason, note")
      .eq("unit_id", id)
      .neq("reason", "booking")
      .gt("end_date", dubaiToday() < gridStart ? dubaiToday() : gridStart)
      .order("start_date"),
    // Upcoming Airbnb stays imported while the unit had no DET permit.
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", id)
      .eq("imported_without_permit", true)
      .in("status", ["confirmed", "checked_in"])
      .gt("check_out", dubaiToday()),
    // Airbnb stays the last sync could not import, and ones linked to a
    // booking here (a private guest who booked through Airbnb, 0036).
    supabase
      .from("channel_feed_clashes")
      .select("ical_uid, code, start_date, end_date, bookings(id, booking_number, check_in, check_out, guests(full_name))")
      .eq("unit_id", id)
      .eq("channel", "airbnb")
      .order("start_date"),
    supabase
      .from("channel_stay_links")
      .select("ical_uid, code, start_date, end_date, bookings(id, booking_number, check_in, check_out, guests(full_name))")
      .eq("unit_id", id)
      .eq("channel", "airbnb")
      .order("start_date"),
  ]);

  if (!unit) notFound();

  const ownerships = ownershipResult.data ?? [];
  const leases = leasesResult.data ?? [];
  const permits = permitResult.data ?? [];
  const compliance = complianceResult.data ?? [];
  const documents = documentsResult.data ?? [];
  const agreement = agreementResult.data;
  const stays = (staysResult.data ?? []).map((b) => ({
    id: b.id,
    checkIn: b.check_in,
    checkOut: b.check_out,
    source: b.channel,
    label: b.guests?.full_name ?? null,
    pending: b.status === "inquiry" || b.status === "tentative",
    href: `/bookings/${b.id}`,
  }));
  const holds = blocksResult.data ?? [];
  const today = dubaiToday();
  // Airbnb's own "not available" periods are managed by the sync, not by hand.
  // The sync's own placeholder ("Not available on Airbnb") is not a note.
  const noteOf = (note: string | null) => (note && !/^Not available on /.test(note) ? note : null);
  const upcomingHolds = holds.filter((h) => h.end_date > today);

  // D|R|P blocks Airbnb only for its private (direct) guests and for the
  // owner. Airbnb's feed says neither which nor why, so each Airbnb block
  // lists the stays and owner stays recorded inside it and offers the nights
  // still unexplained as a private client's booking or an owner stay.
  const airbnbHolds = upcomingHolds.filter((h) => h.reason === "channel_sync");
  const { data: blockStays } = airbnbHolds.length
    ? await supabase
        .from("bookings")
        .select("id, booking_number, check_in, check_out, guests(full_name)")
        .eq("unit_id", id)
        .neq("channel", "airbnb")
        .in("status", ["tentative", "confirmed", "checked_in", "checked_out"])
        .lt("check_in", airbnbHolds.reduce((m, h) => (h.end_date > m ? h.end_date : m), ""))
        .gt("check_out", airbnbHolds.reduce((m, h) => (h.start_date < m ? h.start_date : m), "9999-12-31"))
        .order("check_in")
    : { data: [] };
  const staysIn = (h: { start_date: string; end_date: string }) =>
    (blockStays ?? []).filter((b) => rangesOverlap(b.check_in, b.check_out, h.start_date, h.end_date));
  const ownHoldsIn = (h: { start_date: string; end_date: string }) =>
    upcomingHolds.filter(
      (o) => o.reason !== "channel_sync" && rangesOverlap(o.start_date, o.end_date, h.start_date, h.end_date)
    );
  const freeIn = (h: { start_date: string; end_date: string }) =>
    uncoveredRanges(h.start_date, h.end_date, [
      ...staysIn(h).map((b) => ({ start: b.check_in, end: b.check_out })),
      ...ownHoldsIn(h).map((o) => ({ start: o.start_date, end: o.end_date })),
    ]);

  const activeLease = leases.find(
    (l) => l.status === "active" || l.status === "expiring"
  );
  const property = unit.properties;
  const isShortTerm =
    unit.operating_mode === "short_term" || unit.operating_mode === "both";
  const hasValidPermit = overview?.has_valid_permit ?? false;
  const lastSynced = unit.ical_last_synced_at
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dubai",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(unit.ical_last_synced_at))
    : null;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Units", href: "/units" },
          { label: property?.name ?? "Property" },
        ]}
        title={`${property?.name ?? ""} · ${unit.unit_number}`}
        description={[
          unit.reference_code,
          property?.communities?.name,
          UNIT_KIND[unit.kind],
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {can(profile.role, "maintenance.raise") && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/maintenance/new?unit=${unit.id}`}>
                  <Wrench className="size-4" />
                  Report issue
                </Link>
              </Button>
            )}
            {can(profile.role, "units.manage") && (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/units/${unit.id}/edit`}>
                    <Pencil className="size-4" />
                    Edit
                  </Link>
                </Button>
                {unit.operating_mode !== "long_term" && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/units/${unit.id}/website`}>
                      <Globe className="size-4" />
                      Website
                    </Link>
                  </Button>
                )}
                <RecordActions
                  noun="unit"
                  idName="unitId"
                  id={unit.id}
                  isActive={unit.is_active}
                  archive={archiveUnit}
                  restore={restoreUnit}
                  remove={profile.role === "super_admin" ? deleteUnit : undefined}
                />
              </>
            )}
          </>
        }
      />

      {!unit.is_active && (
        <div className="mb-5">
          <Callout tone="warning" title="This unit is archived">
            It is hidden from lists, the dashboard and reports. Its history is kept.
            Restore it to put it back under management.
          </Callout>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <UnitStatusBadge status={unit.status} />
        <OperatingModeBadge mode={unit.operating_mode} />
        {activeLease && (
          <EjariBadge
            status={activeLease.ejari_status}
            contractNumber={activeLease.ejari_contract_number}
          />
        )}
        {isShortTerm && permits[0] && (
          <PermitBadge status={permits[0].status} permitNumber={permits[0].permit_number} />
        )}
      </div>

      {isShortTerm && !hasValidPermit && (
        <div className="mb-5">
          <Callout tone="danger" title="No valid DET holiday home permit on file">
            This unit is set up for short-term letting but has no active permit. The
            system will refuse to activate any channel listing or accept a booking
            until one is recorded.
          </Callout>
        </div>
      )}

      {compliance.length > 0 && (
        <Card className="mb-5 border-[var(--warning)]/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" />
              Compliance attention ({compliance.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2">
              {compliance.map((item, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{item.label}</span>
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                      {item.kind ? COMPLIANCE_KIND[item.kind] : ""} ·{" "}
                      {formatDate(item.due_date)}
                    </span>
                  </span>
                  <ComplianceBadge
                    severity={item.severity ?? "missing"}
                    daysRemaining={item.days_remaining}
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs
        defaultValue={
          tab && ["tenancy", "calendar", "permits", "documents"].includes(tab) ? tab : "overview"
        }
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tenancy">Tenancy</TabsTrigger>
          {isShortTerm && <TabsTrigger value="calendar">Calendar</TabsTrigger>}
          {isShortTerm && <TabsTrigger value="permits">DET permits</TabsTrigger>}
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Unit details</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGrid>
                  <Field label="Type">{UNIT_KIND[unit.kind]}</Field>
                  <Field label="Bedrooms / bathrooms">
                    {unit.bedrooms} / {unit.bathrooms}
                  </Field>
                  <Field label="Size">
                    {unit.size_sqft
                      ? `${Number(unit.size_sqft).toLocaleString()} sqft · ${Number(unit.size_sqm).toLocaleString()} sqm`
                      : "—"}
                  </Field>
                  <Field label="Furnishing">{FURNISHING[unit.furnishing]}</Field>
                  <Field label="Floor">{unit.floor ?? "—"}</Field>
                  <Field label="Parking">
                    {unit.parking_spaces > 0
                      ? `${unit.parking_spaces} · ${unit.parking_numbers?.join(", ") ?? ""}`
                      : "None"}
                  </Field>
                  <Field label="View">{unit.view_description ?? "—"}</Field>
                  <Field label="DEWA premise">{unit.dewa_premise_number ?? "—"}</Field>
                  <Field label="Title deed">{unit.title_deed_number ?? "—"}</Field>
                  <Field label="Makani">{unit.makani_number ?? "—"}</Field>
                  <Field label="DLD property no.">
                    {unit.dld_property_number ?? "—"}
                  </Field>
                  <Field label="Mollak unit ID">{unit.mollak_unit_id ?? "—"}</Field>
                  {isShortTerm && (
                    <>
                      <Field label="Nightly / weekend rate">
                        {unit.base_nightly_rate_aed ? <Money amount={unit.base_nightly_rate_aed} /> : "—"}
                        {" / "}
                        {unit.weekend_rate_aed ? <Money amount={unit.weekend_rate_aed} /> : "same"}
                      </Field>
                      <Field label="Cleaning fee">
                        {unit.cleaning_fee_aed ? <Money amount={unit.cleaning_fee_aed} /> : "—"}
                      </Field>
                      <Field label="Weekly / monthly discount">
                        {Number(unit.weekly_discount_pct ?? 0)}% / {Number(unit.monthly_discount_pct ?? 0)}%
                      </Field>
                    </>
                  )}
                </FieldGrid>
              </CardContent>
            </Card>

            <div className="space-y-5">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Ownership</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ownerships.length === 0 ? (
                    <p className="text-sm text-[var(--muted-foreground)]">
                      No ownership record on file.
                    </p>
                  ) : (
                    ownerships.map((o) => (
                      <div key={o.id} className="text-sm">
                        <Link
                          href={`/owners/${o.owners?.id}`}
                          className="font-medium hover:underline"
                        >
                          {o.owners?.full_name}
                        </Link>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {formatPercent(o.ownership_pct)} share
                          {o.is_primary_contact && " · primary contact"}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Management agreement</CardTitle>
                </CardHeader>
                <CardContent>
                  {agreement ? (
                    <dl className="space-y-2">
                      <Field label="Agreement">{agreement.agreement_number}</Field>
                      <Field label="Term">
                        {formatDate(agreement.start_date)} –{" "}
                        {formatDate(agreement.end_date)}
                      </Field>
                      <Field label="Fee">
                        {agreement.commission_pct
                          ? `${formatPercent(agreement.commission_pct)} of revenue`
                          : <Money amount={agreement.fixed_fee_aed} />}
                        {agreement.fee_vat_applicable && " + VAT"}
                      </Field>
                      <Field label="Auto renew">
                        {agreement.auto_renew ? "Yes" : "No"}
                      </Field>
                    </dl>
                  ) : (
                    <p className="text-sm text-[var(--muted-foreground)]">
                      No active management agreement. Owner statements cannot charge a
                      management fee for this unit until one is recorded.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tenancy">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Tenancy history</CardTitle>
              {can(profile.role, "leases.manage") && (
                <Button asChild size="sm">
                  <Link href={`/leases/new?unit=${id}`}>
                    <Plus className="size-4" />
                    New tenancy
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {leases.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No tenancies recorded"
                    description="Create a tenancy contract to start tracking rent, Ejari and occupants."
                    icon={<FileSignature className="size-8" />}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract</TableHead>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Term</TableHead>
                      <TableHead className="hidden md:table-cell">Ejari</TableHead>
                      <TableHead className="text-right">Annual rent</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leases.map((lease) => (
                      <TableRow key={lease.id}>
                        <TableCell>
                          <Link
                            href={`/leases/${lease.id}`}
                            className="font-medium hover:underline"
                          >
                            {lease.lease_number}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {lease.tenants?.full_name ?? "—"}
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap text-sm">
                          {formatDate(lease.start_date)} – {formatDate(lease.end_date)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <EjariBadge
                            status={lease.ejari_status}
                            contractNumber={lease.ejari_contract_number}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money amount={lease.annual_rent_aed} compact />
                        </TableCell>
                        <TableCell className="text-right">
                          <LeaseStatusBadge status={lease.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isShortTerm && (
          <>
          <TabsContent value="calendar">
            <ChannelSync
              unitId={unit.id}
              airbnbUrl={unit.airbnb_ical_url}
              exportUrl={`${env.adminUrl}/api/ical/${unit.ical_export_token}.ics`}
              lastSynced={lastSynced}
              status={unit.ical_last_status}
              error={unit.ical_last_error}
              eventCount={unit.ical_last_event_count}
              flaggedCount={hasValidPermit ? 0 : (flaggedResult.count ?? 0)}
              clashes={(clashResult.data ?? []).map(toChannelStay)}
              links={(linkResult.data ?? []).map(toChannelStay)}
              canManage={can(profile.role, "bookings.manage")}
            />
            <Card className="mb-5">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Availability</CardTitle>
                {can(profile.role, "bookings.manage") && (
                  <div className="flex flex-wrap gap-2">
                    <BlockDatesDialog unitId={unit.id} />
                    <Button asChild size="sm">
                      <Link href={`/bookings/new?unit=${unit.id}`}>
                        <CalendarPlus className="size-4" />
                        New booking
                      </Link>
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <BookingCalendar
                  month={month}
                  stays={stays}
                  blocks={holds.map((h) => ({
                    id: h.id,
                    start: h.start_date,
                    end: h.end_date,
                    reason: h.reason,
                    note: noteOf(h.note),
                  }))}
                  monthHref={(m) => `/units/${unit.id}?tab=calendar&month=${m}`}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Blocked dates</CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingHolds.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No upcoming owner stays, maintenance, Airbnb blocks or other blocks.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {upcomingHolds.map((h) => (
                      <li
                        key={h.id}
                        className="flex items-start justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0 text-sm">
                          <span className="font-medium">
                            {h.reason === "owner_stay"
                              ? "Owner stay"
                              : h.reason === "maintenance"
                                ? "Maintenance"
                                : h.reason === "channel_sync"
                                  ? "Blocked on Airbnb"
                                  : "Blocked"}
                          </span>
                          <span className="tabular ml-2 text-[var(--muted-foreground)]">
                            {formatDate(h.start_date)} → {formatDate(h.end_date)}
                          </span>
                          {noteOf(h.note) && (
                            <p className="whitespace-pre-line text-xs text-[var(--muted-foreground)]">{noteOf(h.note)}</p>
                          )}
                          {h.reason === "channel_sync" &&
                            staysIn(h).map((b) => (
                              <Link
                                key={b.id}
                                href={`/bookings/${b.id}`}
                                className="block text-xs text-[var(--success)] hover:underline"
                              >
                                Booked: {b.booking_number}
                                {b.guests?.full_name ? ` · ${b.guests.full_name}` : ""} ·{" "}
                                <span className="tabular">
                                  {formatDate(b.check_in)} → {formatDate(b.check_out)}
                                </span>
                              </Link>
                            ))}
                          {h.reason === "channel_sync" &&
                            ownHoldsIn(h).map((o) => (
                              <p key={o.id} className="text-xs text-[var(--success)]">
                                {o.reason === "owner_stay" ? "Owner stay" : o.reason === "maintenance" ? "Maintenance" : "Blocked"} ·{" "}
                                <span className="tabular">
                                  {formatDate(o.start_date)} → {formatDate(o.end_date)}
                                </span>
                                {noteOf(o.note) && ` · ${noteOf(o.note)}`}
                              </p>
                            ))}
                          {h.reason === "channel_sync" &&
                            can(profile.role, "bookings.manage") &&
                            freeIn(h).map((gap) => (
                              <div key={gap.start} className="mt-2 rounded-md bg-[var(--muted)] p-2">
                                <p className="text-xs text-[var(--muted-foreground)]">
                                  <span className="tabular">
                                    {formatDate(gap.start)} → {formatDate(gap.end)}
                                  </span>{" "}
                                  not recorded yet. Who is staying?
                                </p>
                                <div className="mt-1.5 flex flex-wrap gap-2">
                                  <Button asChild size="sm" variant="outline">
                                    <Link
                                      href={`/bookings/new?unit=${unit.id}&block=${h.id}&checkIn=${gap.start}&checkOut=${gap.end}`}
                                    >
                                      <CalendarPlus className="size-4" />
                                      Private client
                                    </Link>
                                  </Button>
                                  <BlockDatesDialog unitId={unit.id} startDate={gap.start} endDate={gap.end} />
                                </div>
                              </div>
                            ))}
                        </div>
                        {can(profile.role, "bookings.manage") && (
                          <div className="flex shrink-0 items-center">
                            <BlockNoteDialog
                              blockId={h.id}
                              unitId={unit.id}
                              note={noteOf(h.note)}
                              label={`${h.reason === "channel_sync" ? "Blocked on Airbnb" : "Block"}, ${formatDate(h.start_date)} → ${formatDate(h.end_date)}`}
                            />
                            <RemoveBlockButton blockId={h.id} unitId={unit.id} airbnb={h.reason === "channel_sync"} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="permits">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">DET holiday home permits</CardTitle>
                {can(profile.role, "permits.manage") && (
                  <PermitDialog unitId={unit.id} hasPermit={permits.length > 0} />
                )}
              </CardHeader>
              <CardContent className="p-0">
                {permits.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title="No permit on file"
                      description="Dubai requires a valid DET permit before a holiday home may be advertised or let. The permit number must appear on every OTA listing."
                    />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Permit number</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Validity</TableHead>
                        <TableHead className="hidden md:table-cell">NOC</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {permits.map((permit) => (
                        <TableRow key={permit.id} className={can(profile.role, "permits.manage") ? ROW_CLICKABLE : undefined}>
                          <TableCell className="font-medium">
                            {can(profile.role, "permits.manage") ? (
                              <PermitDialog
                                unitId={unit.id}
                                permit={permit}
                                trigger={
                                  <button type="button" className={`${ROW_LINK} text-left`}>
                                    {permit.permit_number}
                                  </button>
                                }
                              />
                            ) : (
                              permit.permit_number
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {permit.det_classification ?? "—"}
                          </TableCell>
                          <TableCell className="tabular whitespace-nowrap text-sm">
                            {formatDate(permit.issued_on)} –{" "}
                            {formatDate(permit.expires_on)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm">
                            {permit.noc_reference ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <PermitBadge status={permit.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          </>
        )}

        <TabsContent value="documents">
          <DocumentList
            documents={documents}
            entityKind="unit"
            entityId={id}
            unitId={id}
            canUpload={can(profile.role, "documents.upload")}
            canDelete={profile.role === "super_admin"}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function toChannelStay(r: {
  ical_uid: string;
  code: string | null;
  start_date: string | null;
  end_date: string | null;
  bookings: {
    id: string;
    booking_number: string;
    check_in: string;
    check_out: string;
    guests: { full_name: string } | null;
  } | null;
}): ChannelStay {
  const b = r.bookings;
  return {
    uid: r.ical_uid,
    code: r.code,
    start: r.start_date,
    end: r.end_date,
    booking: b
      ? { id: b.id, number: b.booking_number, guest: b.guests?.full_name ?? null, checkIn: b.check_in, checkOut: b.check_out }
      : null,
  };
}
