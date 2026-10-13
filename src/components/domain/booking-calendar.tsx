import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  MONTH_SPANS,
  addDays,
  coversNight,
  dubaiToday,
  monthGrid,
  nightsBetween,
  shiftMonth,
  type MonthSpan,
} from "@/lib/calendar";
import { formatMonth } from "@/lib/dates";
import { SALES_CHANNEL } from "@/lib/labels";
import type { Enums } from "@/lib/db/database.types";

export interface CalendarStay {
  id: string;
  checkIn: string;
  checkOut: string;
  source: Enums<"sales_channel">;
  /** Optional detail for the tooltip, e.g. guest first name. */
  label?: string | null;
  /** Unconfirmed requests are drawn outlined rather than filled (admin only). */
  pending?: boolean;
  href?: string;
}

export interface CalendarBlock {
  id: string;
  start: string;
  end: string;
  /** Staff note, shown on the block and in its tooltip. */
  note?: string | null;
  reason: Enums<"block_reason">;
}

const BLOCK_LABEL: Record<Enums<"block_reason">, string> = {
  booking: "Booked",
  maintenance: "Maintenance",
  owner_stay: "Owner stay",
  housekeeping: "Housekeeping",
  blocked: "Blocked",
  channel_sync: "Blocked on Airbnb",
};

const sourceTone = (source: Enums<"sales_channel">) =>
  source === "airbnb"
    ? "bg-rose-500/15 text-rose-800 dark:text-rose-200 border-rose-500/50"
    : source === "direct"
      ? "bg-[var(--brand)]/25 text-[var(--brand-foreground)] dark:text-[var(--brand)] border-[var(--brand)]"
      : "bg-sky-500/15 text-sky-800 dark:text-sky-200 border-sky-500/50";

const BLOCK_TONE =
  "text-[var(--muted-foreground)] bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_6px,transparent_6px,transparent_12px)]";
const OWNER_TONE = "bg-violet-500/15 text-violet-800 dark:text-violet-200 border-violet-500/50";
const MAINTENANCE_TONE = "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/50";

/** Owner stays and maintenance get their own colour; other holds stay hatched. */
const blockTone = (reason: Enums<"block_reason">) =>
  reason === "owner_stay" ? OWNER_TONE : reason === "maintenance" ? MAINTENANCE_TONE : BLOCK_TONE;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Month view of a single unit's calendar. Server-rendered; month navigation is
 * plain links so it works without JavaScript and each month is shareable.
 * With `months` above one it shows that many months in a row, paging by the
 * whole span; `spanHref` adds a picker for how many months to show.
 *
 * It renders whatever it is given and never fetches: the caller decides what
 * the viewer may see (owners pass rows from owner_bookings_view, which has no
 * money in it to begin with).
 */
export function BookingCalendar({
  month,
  months = 1,
  stays,
  blocks = [],
  monthHref,
  spanHref,
}: {
  month: string;
  months?: number;
  stays: CalendarStay[];
  blocks?: CalendarBlock[];
  monthHref: (month: string) => string;
  spanHref?: (months: MonthSpan) => string;
}) {
  const today = dubaiToday();
  const shown = Array.from({ length: months }, (_, i) => shiftMonth(month, i));
  const title =
    months === 1
      ? formatMonth(`${month}-01`)
      : `${formatMonth(`${month}-01`)} – ${formatMonth(`${shown.at(-1)}-01`)}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="flex flex-wrap items-center gap-1">
          {spanHref && (
            <div className="mr-1 flex items-center rounded-md bg-[var(--muted)] p-0.5" aria-label="Months shown">
              {MONTH_SPANS.map((n) => (
                <Link
                  key={n}
                  href={spanHref(n)}
                  scroll={false}
                  aria-current={n === months ? "true" : undefined}
                  className={cn(
                    "rounded px-2 py-1 text-xs",
                    n === months
                      ? "bg-[var(--background)] font-medium shadow-sm"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  )}
                >
                  {n === 12 ? "1 yr" : `${n} mo`}
                </Link>
              ))}
            </div>
          )}
          <Button asChild variant="outline" size="sm" aria-label={months === 1 ? "Previous month" : "Previous months"}>
            <Link href={monthHref(shiftMonth(month, -months))} scroll={false}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={monthHref(today.slice(0, 7))} scroll={false}>
              Today
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" aria-label={months === 1 ? "Next month" : "Next months"}>
            <Link href={monthHref(shiftMonth(month, months))} scroll={false}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="space-y-5">
        {shown.map((m) => (
          <div key={m}>
            {months > 1 && <h4 className="mb-2 text-sm font-medium">{formatMonth(`${m}-01`)}</h4>}
            <MonthGrid month={m} today={today} stays={stays} blocks={blocks} />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--muted-foreground)]">
        <Legend className={sourceTone("airbnb")} label="Airbnb" />
        <Legend className={sourceTone("direct")} label="Direct" />
        <Legend className={sourceTone("booking_com")} label="Other channel" />
        <Legend className={OWNER_TONE} label="Owner stay" />
        <Legend className={MAINTENANCE_TONE} label="Maintenance" />
        <Legend className={BLOCK_TONE} label="Blocked" />
      </div>
    </div>
  );
}

function MonthGrid({
  month,
  today,
  stays,
  blocks,
}: {
  month: string;
  today: string;
  stays: CalendarStay[];
  blocks: CalendarBlock[];
}) {
  const weeks = monthGrid(month);

  // What a night shows: a stay first, then an owner stay or other hold, then
  // an Airbnb block - the hold names what Airbnb only calls "not available".
  const itemAt = (day: string) => {
    const stay = stays.find((s) => coversNight(day, s.checkIn, s.checkOut));
    const block = stay
      ? undefined
      : (blocks.find((b) => b.reason !== "channel_sync" && coversNight(day, b.start, b.end)) ??
        blocks.find((b) => coversNight(day, b.start, b.end)));
    return { stay, block };
  };
  const idAt = (day: string) => {
    const { stay, block } = itemAt(day);
    return stay?.id ?? block?.id;
  };

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--muted)]">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-1.5 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]"
          >
            {d}
          </div>
        ))}
      </div>

      {weeks.map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-b border-[var(--border)] last:border-b-0">
          {week.map((day, i) => {
            const inMonth = day.startsWith(month);
            const { stay, block } = itemAt(day);
            const checkout = stays.find((s) => s.checkOut === day);
            const title = stay
              ? `${SALES_CHANNEL[stay.source]}${stay.pending ? " (pending)" : ""} · ` +
                `${stay.checkIn} → ${stay.checkOut} · ${nightsBetween(stay.checkIn, stay.checkOut)} nights` +
                (stay.label ? ` · ${stay.label}` : "")
              : block
                ? `${BLOCK_LABEL[block.reason]} · ${block.start} → ${block.end}` +
                  (block.note ? ` · ${block.note}` : "")
                : undefined;

            // A stay or block is drawn as one bar across its nights: rounded
            // and labelled only where it really starts and ends. Where it runs
            // on into a new week row, "…" says it continues rather than
            // looking like a second booking.
            // Where a bar begins or ends on screen: its own dates, or where
            // another stay or hold takes over (an owner stay inside an
            // Airbnb block).
            const id = stay?.id ?? block?.id;
            const realStart = stay ? stay.checkIn === day : block?.start === day;
            const first = realStart || idAt(addDays(day, -1)) !== id;
            const last = idAt(addDays(day, 1)) !== id;
            const label = stay
              ? (stay.label ?? SALES_CHANNEL[stay.source])
              : block
                ? (block.note ?? BLOCK_LABEL[block.reason])
                : null;
            const barText = realStart ? (
              <>
                {label}
                {stay && (
                  <span className="hidden sm:inline"> · {nightsBetween(stay.checkIn, stay.checkOut)}n</span>
                )}
              </>
            ) : first || i === 0 ? (
              <span className="opacity-70">… {label}</span>
            ) : (
              <span aria-hidden>&nbsp;</span>
            );
            const barShape = cn(
              "relative z-10 mt-1 truncate py-0.5 text-[10px] font-medium leading-tight sm:text-[11px]",
              first ? "rounded-l pl-1" : "-ml-1 pl-2",
              last ? "rounded-r pr-1" : "-mr-[5px] pr-1"
            );

            const cell = (
              <div
                title={title}
                className={cn("relative h-full min-h-16 p-1 sm:min-h-20", !inMonth && "bg-[var(--muted)]/40")}
              >
                <span
                  className={cn(
                    "tabular inline-flex size-6 items-center justify-center rounded-full text-xs",
                    !inMonth && "text-[var(--muted-foreground)]/60",
                    day === today && "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                  )}
                >
                  {Number(day.slice(8))}
                </span>

                {checkout && !stay && (
                  <span className="absolute right-1 top-1.5 text-[10px] text-[var(--muted-foreground)]">
                    check-out
                  </span>
                )}

                {stay && (
                  <div
                    className={cn(
                      barShape,
                      sourceTone(stay.source),
                      stay.pending
                        ? cn("border-y border-dashed bg-transparent", first && "border-l", last && "border-r")
                        : first && "border-l-2"
                    )}
                  >
                    {barText}
                  </div>
                )}

                {block && (
                  <div className={cn(barShape, blockTone(block.reason), block.reason !== "channel_sync" && block.reason !== "blocked" && first && "border-l-2")}>
                    {barText}
                  </div>
                )}
              </div>
            );

            const gridCell = "border-r border-[var(--border)] last:border-r-0";
            return stay?.href ? (
              <Link key={day} href={stay.href} className={cn(gridCell, "block hover:bg-[var(--muted)]/60")}>
                {cell}
              </Link>
            ) : (
              <div key={day} className={gridCell}>
                {cell}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-3 rounded-sm border-l-2", className)} />
      {label}
    </span>
  );
}
