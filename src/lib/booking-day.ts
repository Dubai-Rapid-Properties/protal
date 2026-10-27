/**
 * The Bookings page's day cards: who arrives, leaves and stays on a chosen
 * day, today by default, or the day before or after. Pure, unit-tested.
 *
 * Today follows the front desk: a guest arriving today counts as arriving
 * until checked in, then as in house. Any other day goes by the dates alone,
 * since Airbnb stays stay "Confirmed" unless someone checks the guest in.
 */
import { addDays } from "@/lib/calendar";
import { formatDate } from "@/lib/dates";

type Status = "inquiry" | "tentative" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";

/** The statuses of a stay that happens, or happened, on another day. */
export const DAY_STATUSES = ["confirmed", "checked_in", "checked_out"] as const satisfies readonly Status[];
/** Today only stays that have not checked out yet. */
export const TODAY_STATUSES = ["confirmed", "checked_in"] as const satisfies readonly Status[];

export type StayDates = { status: string; check_in: string; check_out: string };

/** The day from a query parameter, or today. */
export function parseDay(value: string | null | undefined, today: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  return addDays(value, 0) === value ? value : today;
}

/** "Today", "Yesterday", "Tomorrow" or the date. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  if (day === addDays(today, 1)) return "Tomorrow";
  return formatDate(day);
}

/** A card's heading: "Arriving tomorrow", "In house 30 Oct 2026". */
export function onDay(what: string, day: string, today: string): string {
  const label = dayLabel(day, today);
  return `${what} ${/^\d/.test(label) ? label : label.toLowerCase()}`;
}

export function arrivesOn(b: StayDates, day: string, today: string): boolean {
  if (b.check_in !== day) return false;
  return day === today ? b.status === "confirmed" : (DAY_STATUSES as readonly string[]).includes(b.status);
}

export function departsOn(b: StayDates, day: string, today: string): boolean {
  const statuses: readonly string[] = day === today ? TODAY_STATUSES : DAY_STATUSES;
  return b.check_out === day && statuses.includes(b.status);
}

/** Staying the night, neither arriving nor leaving that day (today: or arrived and checked in). */
export function inHouseOn(b: StayDates, day: string, today: string): boolean {
  if (b.check_out <= day) return false;
  if (day === today) {
    return (TODAY_STATUSES as readonly string[]).includes(b.status) && (b.check_in < day || b.status === "checked_in");
  }
  return b.check_in < day && (DAY_STATUSES as readonly string[]).includes(b.status);
}

export function dayCounts(stays: StayDates[], day: string, today: string) {
  return {
    arriving: stays.filter((b) => arrivesOn(b, day, today)).length,
    departing: stays.filter((b) => departsOn(b, day, today)).length,
    inHouse: stays.filter((b) => inHouseOn(b, day, today)).length,
  };
}
