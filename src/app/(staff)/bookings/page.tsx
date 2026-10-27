import Link from "next/link";
import { BedDouble, Bookmark, CalendarDays, ChevronLeft, ChevronRight, LogIn, LogOut, Plus, Search, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Callout, PageHeader, EmptyState, Money, StatCard } from "@/components/domain/shared";
import { BookingStatusBadge, ChannelBadge } from "@/components/domain/status-badge";
import { ExportButton } from "@/components/domain/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatDate } from "@/lib/dates";
import { addDays, dubaiToday } from "@/lib/calendar";
import { DAY_STATUSES, TODAY_STATUSES, dayCounts, dayLabel, onDay, parseDay } from "@/lib/booking-day";
import { BOOKING_STATUS, SALES_CHANNEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata = { title: "Bookings" };

const VIEWS = {
  upcoming: "Upcoming and in-house",
  arriving: "Arriving",
  departing: "Departing",
  in_house: "In house",
  past: "Past stays",
  cancelled: "Cancelled and no-shows",
  needs_price: "Needs a price",
  all: "All bookings",
} as const;
type View = keyof typeof VIEWS;
/** The views that follow the day chosen above the cards. */
const DAY_VIEWS: readonly View[] = ["arriving", "departing", "in_house"];

const LIVE = ["inquiry", "tentative", "confirmed", "checked_in"] as const;
/** Stays that happen or happened, i.e. that should have a price. */
const PRICED = ["tentative", "confirmed", "checked_in", "checked_out"] as const;
/** The channel tabs above the list; "all" shows every channel. */
const CHANNELS = { all: "All channels", airbnb: "Airbnb", direct: "Direct" } as const;
type ChannelTab = keyof typeof CHANNELS;

/** No payout either: an Airbnb stay can be priced with its payout alone. */
const NO_PAYOUT = "payout_expected_aed.is.null,payout_expected_aed.eq.0";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; unit?: string; channel?: string; day?: string }>;
}) {
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "upcoming";
  const channel: ChannelTab =
    params.channel && params.channel in CHANNELS ? (params.channel as ChannelTab) : "all";
  const today = dubaiToday();
  // The cards' day: today, or the day before or after (?day=YYYY-MM-DD).
  const day = parseDay(params.day, today);
  const isToday = day === today;
  const supabase = await createClient();

  let query = supabase
    .from("bookings")
    .select("*, guests(full_name, phone), units(id, unit_number, properties(name))");

  if (view === "upcoming") {
    query = query.in("status", [...LIVE]).gte("check_out", today).order("check_in");
  } else if (view === "arriving") {
    // The same rules as the cards above (lib/booking-day).
    query = isToday
      ? query.eq("status", "confirmed").eq("check_in", day).order("check_in")
      : query.in("status", [...DAY_STATUSES]).eq("check_in", day).order("check_in");
  } else if (view === "departing") {
    query = query
      .in("status", [...(isToday ? TODAY_STATUSES : DAY_STATUSES)])
      .eq("check_out", day)
      .order("check_in");
  } else if (view === "in_house") {
    query = isToday
      ? query
          .in("status", [...TODAY_STATUSES])
          .gt("check_out", day)
          .or(`check_in.lt.${day},and(check_in.eq.${day},status.eq.checked_in)`)
          .order("check_out")
      : query.in("status", [...DAY_STATUSES]).gt("check_out", day).lt("check_in", day).order("check_out");
  } else if (view === "past") {
    query = query
      .in("status", ["checked_out", "checked_in", "confirmed"])
      .lt("check_out", today)
      .order("check_in", { ascending: false });
  } else if (view === "needs_price") {
    query = query.in("status", [...PRICED]).eq("gross_total_aed", 0).or(NO_PAYOUT).order("check_in");
  } else if (view === "cancelled") {
    query = query.in("status", ["cancelled", "no_show"]).order("check_in", { ascending: false });
  } else {
    query = query.order("check_in", { ascending: false });
  }
  if (params.unit && /^[0-9a-f-]{36}$/i.test(params.unit)) query = query.eq("unit_id", params.unit);
  if (channel !== "all") query = query.eq("channel", channel);
  if (params.q) {
    const term = params.q.replace(/[%,()]/g, "");
    query = query.or(`booking_number.ilike.%${term}%,external_booking_id.ilike.%${term}%`);
  }

  const [profile, { data, error }, unitsResult, unpricedResult, dayResult] = await Promise.all([
    requireCapability("bookings.view"),
    query.limit(500),
    supabase
      .from("v_units_overview")
      .select("id, unit_number, property_name, owner_name")
      .eq("is_active", true)
      .in("operating_mode", ["short_term", "both"])
      .order("property_name"),
    // Stays still waiting for a price (Airbnb imports arrive without one).
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("status", [...PRICED])
      .eq("gross_total_aed", 0)
      .or(NO_PAYOUT),
    // The day's movements, whatever the filter.
    supabase
      .from("bookings")
      .select("status, check_in, check_out")
      .in("status", [...(isToday ? TODAY_STATUSES : DAY_STATUSES)])
      .lte("check_in", day)
      .gte("check_out", day),
  ]);

  const bookings = data ?? [];
  // By dates, not status: Airbnb stays stay "Confirmed" unless someone
  // checks the guest in, but the guest is there all the same.
  const { arriving, departing, inHouse } = dayCounts(dayResult.data ?? [], day, today);
  // Links that keep the chosen day; today needs no parameter.
  const dayQuery = isToday ? "" : `&day=${day}`;
  const dayHref = (d: string) => {
    const qs = new URLSearchParams();
    for (const key of ["view", "channel", "unit", "q"] as const) if (params[key]) qs.set(key, params[key]!);
    if (d !== today) qs.set("day", d);
    return qs.size ? `/bookings?${qs}` : "/bookings";
  };
  const canManage = can(profile.role, "bookings.manage");
  // Housekeeping sees the stays, not what they earn
  const showRevenue = can(profile.role, "bookings.revenue");
  const unpriced = showRevenue ? (unpricedResult.count ?? 0) : 0;

  // The unit's primary owner, shown with each stay.
  const ownerOf = new Map((unitsResult.data ?? []).map((u) => [u.id, u.owner_name]));

  const exportRows = bookings.map((b) => ({
    Booking: b.booking_number,
    Unit: `${b.units?.properties?.name ?? ""} ${b.units?.unit_number ?? ""}`.trim(),
    Owner: ownerOf.get(b.unit_id) ?? "",
    Guest: b.guests?.full_name ?? "",
    Channel: SALES_CHANNEL[b.channel],
    "Channel ref": b.external_booking_id ?? "",
    "Check-in": b.check_in,
    "Check-out": b.check_out,
    Nights: b.nights ?? "",
    Status: BOOKING_STATUS[b.status],
    ...(showRevenue && {
      "Payout (AED)": b.payout_expected_aed ?? b.gross_total_aed,
      "Guest paid (AED)": b.gross_total_aed,
    }),
  }));

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Holiday home stays across every channel."
        actions={
          <>
            <ExportButton rows={exportRows} filename="drp-bookings" />
            {canManage && (
              <Button asChild variant="outline">
                <Link href="/bookings/from-airbnb">
                  <Bookmark className="size-4" />
                  From Airbnb
                </Link>
              </Button>
            )}
            {canManage && (
              <Button asChild variant="outline">
                <Link href="/bookings/import">
                  <Upload className="size-4" />
                  Import Airbnb earnings
                </Link>
              </Button>
            )}
            {canManage && (
              <Button asChild>
                <Link href="/bookings/new">
                  <Plus className="size-4" />
                  New booking
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* The day the cards count: back and forward a day at a time. */}
      <nav className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Day">
        <Button asChild variant="outline" size="icon" className="size-8">
          <Link href={dayHref(addDays(day, -1))} aria-label="Previous day">
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <p className="min-w-28 text-center text-sm font-medium" aria-live="polite">
          {dayLabel(day, today)}
          {dayLabel(day, today) !== formatDate(day) && (
            <span className="font-normal text-[var(--muted-foreground)]"> · {formatDate(day)}</span>
          )}
        </p>
        <Button asChild variant="outline" size="icon" className="size-8">
          <Link href={dayHref(addDays(day, 1))} aria-label="Next day">
            <ChevronRight className="size-4" />
          </Link>
        </Button>
        {!isToday && (
          <Button asChild variant="ghost" size="sm">
            <Link href={dayHref(today)}>Today</Link>
          </Button>
        )}
      </nav>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard
          label={onDay("Arriving", day, today)}
          value={arriving}
          icon={<LogIn className="size-4" />}
          href={`/bookings?view=arriving${dayQuery}`}
        />
        <StatCard
          label={onDay("Departing", day, today)}
          value={departing}
          icon={<LogOut className="size-4" />}
          href={`/bookings?view=departing${dayQuery}`}
        />
        <StatCard
          label={onDay("In house", day, today)}
          value={inHouse}
          icon={<BedDouble className="size-4" />}
          href={`/bookings?view=in_house${dayQuery}`}
        />
      </div>

      {unpriced > 0 && view !== "needs_price" && (
        <div className="mb-4">
          <Callout
            tone="warning"
            title={`${unpriced} ${unpriced === 1 ? "stay has" : "stays have"} no price yet`}
          >
            Airbnb stays arrive from the calendar with dates only.{" "}
            <Link href="/bookings?view=needs_price" className="underline underline-offset-2">
              See them
            </Link>
            {canManage && (
              <>
                {" "}or{" "}
                <Link href="/bookings/import" className="underline underline-offset-2">
                  import Airbnb&apos;s earnings CSV
                </Link>{" "}
                to price them all at once
              </>
            )}
            .
          </Callout>
        </div>
      )}

      {/* Channel tabs: each channel's stays on their own, filters kept. */}
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="Channel">
        {(Object.keys(CHANNELS) as ChannelTab[]).map((c) => {
          const qs = new URLSearchParams();
          if (c !== "all") qs.set("channel", c);
          if (view !== "upcoming") qs.set("view", view);
          if (params.unit) qs.set("unit", params.unit);
          if (params.q) qs.set("q", params.q);
          if (!isToday) qs.set("day", day);
          const href = qs.size ? `/bookings?${qs}` : "/bookings";
          return (
            <Link
              key={c}
              href={href}
              aria-current={c === channel ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                c === channel
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {CHANNELS[c]}
            </Link>
          );
        })}
      </nav>

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            {channel !== "all" && <input type="hidden" name="channel" value={channel} />}
            {!isToday && <input type="hidden" name="day" value={day} />}
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Booking number or channel reference"
                className="pl-8"
              />
            </div>
            <Select name="unit" defaultValue={params.unit ?? ""} className="sm:w-56">
              <option value="">All holiday home units</option>
              {(unitsResult.data ?? []).map((u) => (
                <option key={u.id!} value={u.id!}>
                  {u.property_name} · {u.unit_number}
                </option>
              ))}
            </Select>
            <Select key={view} name="view" defaultValue={view} className="sm:w-52">
              {Object.entries(VIEWS)
                .filter(([value]) => showRevenue || value !== "needs_price")
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {DAY_VIEWS.includes(value as View) ? onDay(label, day, today) : label}
                  </option>
                ))}
            </Select>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <EmptyState
          title="Could not load bookings"
          description={error.message}
          icon={<CalendarDays className="size-8" />}
        />
      ) : bookings.length === 0 ? (
        <EmptyState
          title="No bookings here"
          description={
            view === "upcoming"
              ? "No upcoming stays. Add a booking, or change the filter to see past stays."
              : "Nothing matches these filters."
          }
          icon={<CalendarDays className="size-8" />}
          action={
            canManage ? (
              <Button asChild>
                <Link href="/bookings/new">New booking</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking</TableHead>
                <TableHead className="hidden sm:table-cell">Unit</TableHead>
                <TableHead className="hidden md:table-cell">Guest</TableHead>
                <TableHead>Stay</TableHead>
                <TableHead className="hidden lg:table-cell">Channel</TableHead>
                <TableHead>Status</TableHead>
                {showRevenue && <TableHead className="hidden text-right sm:table-cell">Payout</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id} className={ROW_CLICKABLE}>
                  <TableCell>
                    <Link href={`/bookings/${b.id}`} className={ROW_LINK}>
                      {b.booking_number}
                    </Link>
                    {b.external_booking_id && (
                      <p className="text-xs text-[var(--muted-foreground)]">{b.external_booking_id}</p>
                    )}
                    {/* On a phone the unit sits under the booking, not in its own column. */}
                    <p className="text-xs sm:hidden">
                      {b.units?.properties?.name} · {b.units?.unit_number}
                      {ownerOf.get(b.unit_id) && ` · ${ownerOf.get(b.unit_id)}`}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {b.units?.properties?.name} · {b.units?.unit_number}
                    {ownerOf.get(b.unit_id) && (
                      <p className="text-xs text-[var(--muted-foreground)]">Owner: {ownerOf.get(b.unit_id)}</p>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {b.guests?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="tabular text-sm sm:whitespace-nowrap">
                    {formatDate(b.check_in)} → {formatDate(b.check_out)}
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {b.nights} night{b.nights === 1 ? "" : "s"}
                    </p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <ChannelBadge channel={b.channel} />
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={b.status} />
                  </TableCell>
                  {showRevenue && (
                    <TableCell className="hidden text-right sm:table-cell">
                      {Number(b.gross_total_aed) === 0 &&
                      !Number(b.payout_expected_aed) &&
                      b.status !== "cancelled" &&
                      b.status !== "no_show" ? (
                        <Link
                          href={`/bookings/${b.id}?price=1`}
                          className="relative z-10 text-xs text-[var(--warning)] underline underline-offset-2"
                        >
                          No price yet
                        </Link>
                      ) : (
                        // What D|R|P receives: Airbnb's "Amount" for imported stays.
                        <Money amount={b.payout_expected_aed ?? b.gross_total_aed} />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
