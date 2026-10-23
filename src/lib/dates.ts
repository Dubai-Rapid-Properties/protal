import { differenceInCalendarDays, format, parseISO, isValid } from "date-fns";

/** Dubai runs on a fixed UTC+4 offset with no daylight saving. */
export const TIMEZONE = "Asia/Dubai";

const toDateOrNull = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return isValid(d) ? d : null;
};

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDateOrNull(value);
  return d ? format(d, "dd MMM yyyy") : "—";
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDateOrNull(value);
  return d ? format(d, "dd MMM yyyy, HH:mm") : "—";
}

export function formatMonth(value: string | Date | null | undefined): string {
  const d = toDateOrNull(value);
  return d ? format(d, "MMMM yyyy") : "—";
}

/** Negative means the date has already passed. */
export function daysUntil(value: string | Date | null | undefined): number | null {
  const d = toDateOrNull(value);
  return d ? differenceInCalendarDays(d, new Date()) : null;
}

export function relativeExpiry(value: string | Date | null | undefined): string {
  const days = daysUntil(value);
  if (days === null) return "—";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 60) return `in ${days} days`;
  return formatDate(value);
}

/** Matches the severity banding in v_compliance_status. */
export type Severity = "ok" | "due_soon" | "urgent" | "overdue" | "missing";

export function severityFor(daysRemaining: number | null): Severity {
  if (daysRemaining === null) return "missing";
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining <= 7) return "urgent";
  if (daysRemaining <= 60) return "due_soon";
  return "ok";
}

export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function monthBounds(date = new Date()): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
}

/**
 * The owner statement period finance runs on the 15th of each month: from the
 * 16th of the month before to the latest 15th on or before `today`
 * (YYYY-MM-DD). On 23 Oct that is 16 Sep - 15 Oct; on 10 Oct, 16 Aug - 15 Sep.
 */
export function statementPeriod(today: string): { start: string; end: string } {
  const [y, m, d] = today.split("-").map(Number);
  const endMonth = d >= 15 ? m - 1 : m - 2; // 0-based month of the closing 15th
  const end = new Date(Date.UTC(y, endMonth, 15));
  const start = new Date(Date.UTC(y, endMonth - 1, 16));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * A rolling window ending today.
 *
 * Preferred over calendar-month bounds for operational dashboards: on the 1st
 * of a month a calendar-month figure is near-empty and tells the reader
 * nothing, whereas a rolling 30 days is comparable on any day.
 */
export function rollingWindow(days = 30): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
}

/**
 * A statement or report period, written the way a reader expects: a whole
 * calendar month collapses to "January 2026", anything else stays a range.
 */
export function formatPeriod(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined
): string {
  const s = toDateOrNull(start);
  const e = toDateOrNull(end);
  if (!s || !e) return "—";

  const isWholeMonth =
    s.getDate() === 1 &&
    s.getMonth() === e.getMonth() &&
    s.getFullYear() === e.getFullYear() &&
    e.getDate() === new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate();

  if (isWholeMonth) return format(s, "MMMM yyyy");

  const sameYear = s.getFullYear() === e.getFullYear();
  return `${format(s, sameYear ? "d MMM" : "d MMM yyyy")} – ${format(e, "d MMM yyyy")}`;
}
