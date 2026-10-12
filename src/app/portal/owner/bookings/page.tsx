import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getPortalSettings } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/domain/shared";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dubaiToday } from "@/lib/calendar";
import { OwnerBookingsTable } from "../owner-bookings-table";

export const metadata = { title: "Bookings" };

const VIEWS = {
  upcoming: "Upcoming",
  past: "Past",
  all: "All",
} as const;
type View = keyof typeof VIEWS;

export default async function OwnerBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; unit?: string }>;
}) {
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "upcoming";
  const today = dubaiToday();

  const supabase = await createClient();

  // The view only ever returns the caller's own units, so an arbitrary id here
  // can narrow the list but never widen it.
  const unitFilter = z.string().uuid().safeParse(params.unit).success ? params.unit : undefined;

  let query = supabase.from("owner_bookings_view").select("*");
  if (unitFilter) query = query.eq("unit_id", unitFilter);
  if (view === "upcoming") query = query.gt("check_out", today).order("check_in");
  else if (view === "past") query = query.lte("check_out", today).order("check_in", { ascending: false });
  else query = query.order("check_in", { ascending: false });

  const [, settings, { data: bookings }, { data: units }] = await Promise.all([
    requireRole(["owner"]),
    getPortalSettings(),
    query.limit(500),
    supabase.from("owner_units_view").select("id, property_name, unit_number").order("property_name"),
  ]);

  const rows = bookings ?? [];

  const href = (next: { view?: View; unit?: string }) => {
    const qs = new URLSearchParams();
    const v = next.view ?? view;
    const u = "unit" in next ? next.unit : unitFilter;
    if (v !== "upcoming") qs.set("view", v);
    if (u) qs.set("unit", u);
    const s = qs.toString();
    return `/portal/owner/bookings${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Confirmed stays across your properties: dates, nights, guests and where the booking came from."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={href({ view: v })}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              v === view
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {VIEWS[v]}
          </Link>
        ))}
        {units && units.length > 1 && (
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Link
              href={href({ unit: undefined })}
              className={cn("rounded-md px-2.5 py-1 text-xs", !unitFilter ? "bg-[var(--secondary)] font-medium" : "text-[var(--muted-foreground)]")}
            >
              All properties
            </Link>
            {units.map((u) => (
              <Link
                key={u.id}
                href={href({ unit: u.id! })}
                className={cn("rounded-md px-2.5 py-1 text-xs", unitFilter === u.id ? "bg-[var(--secondary)] font-medium" : "text-[var(--muted-foreground)]")}
              >
                {u.property_name} · {u.unit_number}
              </Link>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={view === "past" ? "No past stays" : view === "all" ? "No stays yet" : "No upcoming stays"}
          description="Confirmed bookings on your properties appear here."
          icon={<CalendarDays className="size-8" />}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <OwnerBookingsTable
              bookings={rows}
              showGuestName={settings?.show_guest_first_name_to_owners ?? false}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
