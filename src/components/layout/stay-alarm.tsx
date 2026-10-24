"use client";

import * as React from "react";
import Link from "next/link";
import { BedDouble, BellRing, Check, DoorClosed, DoorOpen } from "lucide-react";
import { toast } from "sonner";
import { noteIfStale, portalIsStale } from "@/lib/stale-client";
import { Button } from "@/components/ui/button";
import { ackStayAlarm, getStayAlarms, type StayAlarm } from "@/app/(staff)/alarm-actions";
import { useAlarmSound } from "./alarm-sound";

const POLL_MS = 30_000;

const key = (a: StayAlarm) => `${a.bookingId}:${a.kind}:${a.stage}`;

function label(a: StayAlarm) {
  if (a.kind === "prepare") return `Check-in tomorrow (${a.dueAt}): get the unit ready`;
  const what = a.kind === "check_out" ? "Check-out" : "Check-in";
  return a.stage === 1 ? `${what} in 1 hour (${a.dueAt})` : `${what} now (${a.dueAt})`;
}

/**
 * Super admins and housekeeping (the layout renders it for them alone). Guests
 * leave by 12:00 and arrive from 15:00, Dubai time; for every stay ending or
 * starting today the alarm rings an hour ahead and again on the time, and
 * keeps ringing until someone presses "Done". There is no silence button.
 */
export function StayAlarmBanner() {
  const [alarms, setAlarms] = React.useState<StayAlarm[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (portalIsStale()) return;
    try {
      setAlarms(await getStayAlarms());
    } catch (err) {
      // Keep the last list; the next poll tries again. A tab left open across a deploy stops
      // asking and says the portal was updated (stale-client.ts).
      noteIfStale(err);
    }
  }, []);

  React.useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const { soundBlocked } = useAlarmSound(alarms.length > 0);

  if (alarms.length === 0) return null;

  async function done(a: StayAlarm) {
    setBusy(key(a));
    let result: { error?: string };
    try {
      result = await ackStayAlarm(a);
    } catch (err) {
      result = { error: noteIfStale(err) ? "The portal was updated: reload this page, then press Done." : "Could not reach the portal. Try again." };
    }
    setBusy(null);
    if (result.error) toast.error(result.error);
    else setAlarms((list) => list.filter((x) => key(x) !== key(a)));
  }

  return (
    <div
      role="alert"
      className="sticky top-0 z-40 mb-4 rounded-lg border-2 border-[var(--warning)] bg-[var(--background)] p-3 shadow-lg print:hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <BellRing className="size-5 animate-bounce" />
          {alarms.every((a) => a.kind === "prepare")
            ? `${alarms.length} check-in${alarms.length === 1 ? "" : "s"} tomorrow to get ready`
            : alarms.length === 1
              ? "Check-out / check-in today"
              : `${alarms.length} check-outs / check-ins`}
        </p>
        {soundBlocked && (
          <span className="text-xs text-[var(--muted-foreground)]">Click anywhere to turn the alarm sound on</span>
        )}
      </div>
      <ul className="mt-2 space-y-2">
        {alarms.map((a) => (
          <li
            key={key(a)}
            className="flex flex-col gap-2 rounded-md bg-[var(--warning)]/15 p-2 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="flex flex-wrap items-center gap-x-1">
              {a.kind === "check_out" ? (
                <DoorOpen className="size-4" />
              ) : a.kind === "prepare" ? (
                <BedDouble className="size-4" />
              ) : (
                <DoorClosed className="size-4" />
              )}
              <span className="font-medium">{label(a)}</span> · <span>{a.unit}</span>
              {a.guest && ` · ${a.guest}`} ·{" "}
              <Link href={`/bookings/${a.bookingId}`} className="underline underline-offset-2">
                {a.bookingNumber}
              </Link>
            </p>
            <Button type="button" size="sm" disabled={busy === key(a)} onClick={() => done(a)}>
              <Check className="size-4" />
              Done
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
