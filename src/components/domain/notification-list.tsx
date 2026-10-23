"use client";

import * as React from "react";
import Link from "next/link";
import { BadgeCheck, Bell, CalendarPlus, CalendarRange, CalendarX2, ClipboardCheck, FileCheck2, FileText, HandCoins, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/domain/shared";
import { markNotificationsRead } from "@/lib/notify/actions";

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  booking_new: CalendarPlus,
  booking_changed: CalendarRange,
  booking_cancelled: CalendarX2,
  ticket_new: Wrench,
  ticket_status: ClipboardCheck,
  refund_new: HandCoins,
  refund_settled: BadgeCheck,
  statement_review: FileText,
  statement_done: FileCheck2,
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  }).format(new Date(iso));

/**
 * The signed-in user's notifications, newest first. What was unread when the
 * page opened keeps its dot for the whole visit, even though the list is
 * marked read straight away (which also clears the sidebar count).
 */
export function NotificationList({ rows }: { rows: NotificationRow[] }) {
  const [unseen] = React.useState(() => new Set(rows.filter((r) => !r.read_at).map((r) => r.id)));

  React.useEffect(() => {
    if (unseen.size > 0) void markNotificationsRead();
  }, [unseen]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No notifications yet"
        description="Bookings, repairs and complaints on your properties appear here as they happen."
        icon={<Bell className="size-8" />}
      />
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((n) => {
          const Icon = ICON[n.kind] ?? Bell;
          const content = (
            <div className="flex items-start gap-3 px-4 py-3">
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  n.kind === "booking_cancelled" ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"
                )}
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", unseen.has(n.id) && "font-semibold")}>{n.title}</p>
                <p className="text-sm text-[var(--muted-foreground)]">{n.body}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular text-xs text-[var(--muted-foreground)]">{when(n.created_at)}</span>
                {unseen.has(n.id) && (
                  <span className="size-2 rounded-full bg-[var(--destructive)]" aria-label="New" />
                )}
              </div>
            </div>
          );
          return (
            <li key={n.id}>
              {n.link ? (
                <Link href={n.link} className="block hover:bg-[var(--muted)]/60">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
