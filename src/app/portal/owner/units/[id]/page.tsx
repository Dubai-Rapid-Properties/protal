import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getPortalSettings } from "@/lib/auth/session";
import { PageHeader, EmptyState, Field, FieldGrid } from "@/components/domain/shared";
import { UnitStatusBadge } from "@/components/domain/status-badge";
import { BookingCalendar } from "@/components/domain/booking-calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dubaiToday, monthSpanRange, parseMonth, parseMonthSpan, withinHorizonFilter } from "@/lib/calendar";
import { formatDate } from "@/lib/dates";
import { UNIT_KIND } from "@/lib/labels";
import { OwnerBookingsTable } from "../../owner-bookings-table";

export const metadata = { title: "Property calendar" };

/** Past stays listed here before linking to the full bookings list. */
const PAST_SHOWN = 20;

export default async function OwnerUnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; months?: string }>;
}) {
  const { id } = await params;
  const { month: monthParam, months: monthsParam } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const month = parseMonth(monthParam);
  // Owners plan further ahead than one month, so the calendar opens on three.
  const months = parseMonthSpan(monthsParam, 3);
  const { start: gridStart, end: gridEnd } = monthSpanRange(month, months);
  const today = dubaiToday();
  const calendarHref = (m: string, n: number) => `/portal/owner/units/${id}?month=${m}&months=${n}`;

  const supabase = await createClient();

  // All three are owner-safe views: a unit that is not the caller's simply
  // returns no row, so there is no ownership check to get wrong here.
  const [, settings, unitResult, calendarResult, blocksResult, upcomingResult, pastResult] = await Promise.all([
    requireRole(["owner"]),
    getPortalSettings(),
    supabase.from("owner_units_view").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("owner_bookings_view")
      .select("id, check_in, check_out, source, guest_first_name")
      .eq("unit_id", id)
      .lt("check_in", gridEnd)
      .gt("check_out", gridStart),
    supabase
      .from("owner_calendar_blocks_view")
      .select("*")
      .eq("unit_id", id)
      .lt("start_date", gridEnd)
      .gt("end_date", gridStart)
      .or(withinHorizonFilter(today)),
    supabase
      .from("owner_bookings_view")
      .select("*")
      .eq("unit_id", id)
      .gt("check_out", today)
      .order("check_in")
      .limit(50),
    supabase
      .from("owner_bookings_view")
      .select("*", { count: "exact" })
      .eq("unit_id", id)
      .lte("check_out", today)
      .order("check_in", { ascending: false })
      .limit(PAST_SHOWN),
  ]);

  const unit = unitResult.data;
  if (!unit) notFound();

  const showGuestName = settings?.show_guest_first_name_to_owners ?? false;
  const stays = (calendarResult.data ?? []).map((b) => ({
    id: b.id!,
    checkIn: b.check_in!,
    checkOut: b.check_out!,
    source: b.source!,
    label: showGuestName ? b.guest_first_name : null,
  }));
  const blocks = (blocksResult.data ?? []).map((b) => ({
    id: b.id!,
    start: b.start_date!,
    end: b.end_date!,
    reason: b.reason!,
  }));
  const upcoming = upcomingResult.data ?? [];
  const past = pastResult.data ?? [];
  const pastTotal = pastResult.count ?? past.length;

  return (
    <>
      <PageHeader
        title={`${unit.property_name} · ${unit.unit_number}`}
        description={[unit.community_name, unit.kind && UNIT_KIND[unit.kind]].filter(Boolean).join(" · ")}
        breadcrumb={[{ label: "My properties", href: "/portal/owner/units" }, { label: unit.unit_number ?? "" }]}
        actions={unit.status ? <UnitStatusBadge status={unit.status} /> : undefined}
      />

      <Card className="mb-6">
        <CardContent className="p-5">
          <FieldGrid columns={4}>
            <Field label="Bedrooms">
              {Number(unit.bedrooms) === 0 ? "Studio" : (unit.bedrooms ?? "—")}
            </Field>
            <Field label="Bathrooms">{unit.bathrooms ?? "—"}</Field>
            <Field label="Max guests">{unit.max_guests ?? "—"}</Field>
            <Field label="DET permit">
              {unit.det_permit_number
                ? `${unit.det_permit_number} · to ${formatDate(unit.det_permit_expiry)}`
                : "—"}
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="p-4 sm:p-5">
          <BookingCalendar
            month={month}
            months={months}
            stays={stays}
            blocks={blocks}
            monthHref={(m) => calendarHref(m, months)}
            spanHref={(n) => calendarHref(month, n)}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Upcoming stays</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No upcoming stays" />
            </div>
          ) : (
            <OwnerBookingsTable bookings={upcoming} showProperty={false} showGuestName={showGuestName} />
          )}
        </CardContent>
      </Card>

      {past.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Past stays</CardTitle>
            {pastTotal > past.length && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/portal/owner/bookings?view=past&unit=${id}`}>
                  View all {pastTotal}
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <OwnerBookingsTable bookings={past} showProperty={false} showGuestName={showGuestName} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
