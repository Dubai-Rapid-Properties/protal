import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, PageHeader } from "@/components/domain/shared";
import { addDays, dubaiToday } from "@/lib/calendar";
import { formatDate } from "@/lib/dates";
import { IncidentForm, type BookingOption } from "./incident-form";

export const metadata = { title: "Report incident" };

export default async function NewIncidentPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; booking?: string }>;
}) {
  const params = await searchParams;
  const bookingParam = z.string().uuid().safeParse(params.booking).success ? params.booking! : undefined;
  const today = dubaiToday();
  const supabase = await createClient();

  // Stays from the last 60 days and those starting by tomorrow: the guests an
  // incident is usually found after. A stay opened from its own page is
  // always offered, however old.
  const bookingColumns = "id, unit_id, booking_number, check_in, check_out, guests(full_name)";
  const [, { data: unitRows }, { data: recent }, { data: picked }] = await Promise.all([
    requireCapability("incidents.report"),
    supabase
      .from("v_units_overview")
      .select("id, unit_number, property_name")
      .eq("is_active", true)
      .order("property_name")
      .order("unit_number"),
    supabase
      .from("bookings")
      .select(bookingColumns)
      .in("status", ["confirmed", "checked_in", "checked_out"])
      .gte("check_out", addDays(today, -60))
      .lte("check_in", addDays(today, 1))
      .order("check_in", { ascending: false })
      .limit(500),
    bookingParam
      ? supabase.from("bookings").select(bookingColumns).eq("id", bookingParam).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const units = (unitRows ?? []).map((u) => ({ id: u.id!, label: `${u.property_name} · ${u.unit_number}` }));
  const rows = [...(picked ? [picked] : []), ...(recent ?? []).filter((b) => b.id !== picked?.id)];
  const bookings: BookingOption[] = rows.map((b) => ({
    id: b.id,
    unitId: b.unit_id,
    label: `${b.guests?.full_name ?? "Guest"} · ${formatDate(b.check_in)} → ${formatDate(b.check_out)} · ${b.booking_number}`,
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Guest incidents", href: "/incidents" }]}
        title="Report incident"
        description="What a guest did to the unit. Staff only - the owner never sees this."
      />
      {units.length === 0 && (
        <div className="mb-5">
          <Callout tone="info" title="No units yet">
            Add a unit first; every incident belongs to a unit.
          </Callout>
        </div>
      )}
      <IncidentForm
        units={units}
        bookings={bookings}
        defaultUnitId={picked?.unit_id ?? params.unit}
        defaultBookingId={picked?.id}
        today={today}
      />
    </>
  );
}
