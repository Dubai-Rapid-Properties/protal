import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/domain/shared";
import { BookingCalendar } from "@/components/domain/booking-calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dubaiToday, monthSpanRange, parseMonth, parseMonthSpan, withinHorizonFilter } from "@/lib/calendar";

export const metadata = { title: "Calendar" };

/** Airbnb's own "not available" placeholder is not a note worth showing. */
const noteOf = (note: string | null) => (note && !/^Not available on /.test(note) ? note : null);

/**
 * Every holiday home's calendar, one under another, on the same months: three
 * by default, up to a year ahead or back. RLS decides which units a staff
 * member sees, so a property manager gets only their own.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; months?: string }>;
}) {
  const { month: monthParam, months: monthsParam } = await searchParams;
  const month = parseMonth(monthParam);
  const months = parseMonthSpan(monthsParam, 3);
  const { start: gridStart, end: gridEnd } = monthSpanRange(month, months);
  const calendarHref = (m: string, n: number) => `/calendar?month=${m}&months=${n}`;
  const today = dubaiToday();

  const supabase = await createClient();
  const [, unitsResult] = await Promise.all([
    requireCapability("bookings.view"),
    supabase
      .from("v_units_overview")
      .select("id, property_name, unit_number")
      .eq("is_active", true)
      .in("operating_mode", ["short_term", "both"])
      .order("property_name")
      .order("unit_number"),
  ]);
  const units = unitsResult.data ?? [];
  const ids = units.map((u) => u.id!);

  const [staysResult, blocksResult] = ids.length
    ? await Promise.all([
        supabase
          .from("bookings")
          .select("id, unit_id, check_in, check_out, channel, status, guests(full_name)")
          .in("unit_id", ids)
          .in("status", ["inquiry", "tentative", "confirmed", "checked_in", "checked_out"])
          .lt("check_in", gridEnd)
          .gt("check_out", gridStart),
        supabase
          .from("availability_blocks")
          .select("id, unit_id, start_date, end_date, reason, note")
          .in("unit_id", ids)
          .neq("reason", "booking")
          .lt("start_date", gridEnd)
          .gt("end_date", gridStart)
          .or(withinHorizonFilter(today)),
      ])
    : [{ data: [] }, { data: [] }];

  const stays = staysResult.data ?? [];
  const blocks = blocksResult.data ?? [];

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Booked, held and free nights for every holiday home. Select a stay to open its booking."
      />

      {units.length === 0 ? (
        <EmptyState
          title="No holiday homes yet"
          description="Units run short-term (or both) appear here with their bookings and blocked dates."
          icon={<CalendarDays className="size-8" />}
        />
      ) : (
        <div className="space-y-6">
          {units.map((unit) => (
            <Card key={unit.id}>
              <CardHeader className="pb-0">
                <CardTitle className="text-base">
                  <Link href={`/units/${unit.id}?tab=calendar`} className="hover:underline">
                    {unit.property_name} · {unit.unit_number}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                <BookingCalendar
                  month={month}
                  months={months}
                  stays={stays
                    .filter((b) => b.unit_id === unit.id)
                    .map((b) => ({
                      id: b.id,
                      checkIn: b.check_in,
                      checkOut: b.check_out,
                      source: b.channel,
                      label: b.guests?.full_name ?? null,
                      pending: b.status === "inquiry" || b.status === "tentative",
                      href: `/bookings/${b.id}`,
                    }))}
                  blocks={blocks
                    .filter((b) => b.unit_id === unit.id)
                    .map((b) => ({ id: b.id, start: b.start_date, end: b.end_date, reason: b.reason, note: noteOf(b.note) }))}
                  monthHref={(m) => calendarHref(m, months)}
                  spanHref={(n) => calendarHref(month, n)}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
