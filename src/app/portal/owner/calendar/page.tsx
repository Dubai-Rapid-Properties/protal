import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getPortalSettings } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/domain/shared";
import { BookingCalendar } from "@/components/domain/booking-calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { monthSpanRange, parseMonth, parseMonthSpan } from "@/lib/calendar";

export const metadata = { title: "Calendar" };

/**
 * The calendar of every holiday home the owner has, one under another, all on
 * the same months - three by default, up to a year ahead or back. Built only from the owner-safe views, so there is
 * no money here to hide.
 */
export default async function OwnerCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; months?: string }>;
}) {
  const { month: monthParam, months: monthsParam } = await searchParams;
  const month = parseMonth(monthParam);
  const months = parseMonthSpan(monthsParam, 3);
  const { start: gridStart, end: gridEnd } = monthSpanRange(month, months);
  const calendarHref = (m: string, n: number) => `/portal/owner/calendar?month=${m}&months=${n}`;

  const supabase = await createClient();
  const [, settings, unitsResult] = await Promise.all([
    requireRole(["owner"]),
    getPortalSettings(),
    supabase
      .from("owner_units_view")
      .select("id, property_name, unit_number, operating_mode")
      .eq("is_active", true)
      .in("operating_mode", ["short_term", "both"])
      .order("property_name"),
  ]);
  const units = unitsResult.data ?? [];
  const ids = units.map((u) => u.id!);

  const [staysResult, blocksResult] = ids.length
    ? await Promise.all([
        supabase
          .from("owner_bookings_view")
          .select("id, unit_id, check_in, check_out, source, guest_first_name")
          .in("unit_id", ids)
          .lt("check_in", gridEnd)
          .gt("check_out", gridStart),
        supabase
          .from("owner_calendar_blocks_view")
          .select("*")
          .in("unit_id", ids)
          .lt("start_date", gridEnd)
          .gt("end_date", gridStart),
      ])
    : [{ data: [] }, { data: [] }];

  const showGuestName = settings?.show_guest_first_name_to_owners ?? false;

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Booked, blocked and free nights for each of your holiday homes."
      />

      {units.length === 0 ? (
        <EmptyState
          title="No holiday homes yet"
          description="When D|R|P runs one of your properties as a holiday home, its calendar appears here."
          icon={<CalendarDays className="size-8" />}
        />
      ) : (
        <div className="space-y-6">
          {units.map((unit) => (
            <Card key={unit.id}>
              {units.length > 1 && (
                <CardHeader className="pb-0">
                  <CardTitle className="text-base">
                    <Link href={`/portal/owner/units/${unit.id}`} className="hover:underline">
                      {unit.property_name} · {unit.unit_number}
                    </Link>
                  </CardTitle>
                </CardHeader>
              )}
              <CardContent className="p-4 sm:p-5">
                <BookingCalendar
                  month={month}
                  months={months}
                  stays={(staysResult.data ?? [])
                    .filter((b) => b.unit_id === unit.id)
                    .map((b) => ({
                      id: b.id!,
                      checkIn: b.check_in!,
                      checkOut: b.check_out!,
                      source: b.source!,
                      label: showGuestName ? b.guest_first_name : null,
                    }))}
                  blocks={(blocksResult.data ?? [])
                    .filter((b) => b.unit_id === unit.id)
                    .map((b) => ({ id: b.id!, start: b.start_date!, end: b.end_date!, reason: b.reason! }))}
                  monthHref={(m) => calendarHref(m, months)}
                  spanHref={(n) => calendarHref(month, n)}
                />
                {units.length === 1 && (
                  <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                    <Link href={`/portal/owner/units/${unit.id}`} className="underline underline-offset-2">
                      {unit.property_name} · {unit.unit_number}
                    </Link>{" "}
                    - upcoming and past stays, and property details
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
