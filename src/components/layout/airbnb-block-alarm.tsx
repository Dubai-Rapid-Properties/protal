"use client";

import * as React from "react";
import Link from "next/link";
import { BellRing, Check, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { getAirbnbBlockAlarms, markAirbnbBlocked, type AirbnbBlockAlarm } from "@/app/(staff)/alarm-actions";
import { useAlarmSound } from "./alarm-sound";

const POLL_MS = 30_000;
const SILENCE_MS = 10 * 60_000;

/**
 * Super admins only (the layout renders it for them alone). A booking made
 * on the D|R|P website holds the unit here at once, but Airbnb can still sell
 * the same nights until someone blocks them there. Until a super admin
 * presses "Done", every staff page shows the booking and an alarm sounds.
 */
export function AirbnbBlockAlarmBanner() {
  const [alarms, setAlarms] = React.useState<AirbnbBlockAlarm[]>([]);
  const [silencedUntil, setSilencedUntil] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setAlarms(await getAirbnbBlockAlarms());
    } catch {
      // Keep the last list; the next poll tries again.
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

  const { soundBlocked } = useAlarmSound(alarms.length > 0 && Date.now() >= silencedUntil);

  if (alarms.length === 0) return null;

  async function done(a: AirbnbBlockAlarm) {
    setBusy(a.bookingId);
    const result = await markAirbnbBlocked(a.bookingId);
    setBusy(null);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`${a.bookingNumber}: marked as blocked on Airbnb.`);
      setAlarms((list) => list.filter((x) => x.bookingId !== a.bookingId));
    }
  }

  const silenced = Date.now() < silencedUntil;

  return (
    <div
      role="alert"
      className="sticky top-0 z-40 mb-4 rounded-lg border-2 border-[var(--destructive)] bg-[var(--background)] p-3 shadow-lg print:hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-[var(--destructive)]">
          <BellRing className={silenced ? "size-5" : "size-5 animate-bounce"} />
          {alarms.length === 1 ? "New website booking" : `${alarms.length} new website bookings`} - block on Airbnb now
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {soundBlocked && !silenced && (
            <span className="text-xs text-[var(--muted-foreground)]">Click anywhere to turn the alarm sound on</span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSilencedUntil(silenced ? 0 : Date.now() + SILENCE_MS)}
          >
            {silenced ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            {silenced ? "Sound on" : "Silence 10 min"}
          </Button>
        </div>
      </div>
      <ul className="mt-2 space-y-2">
        {alarms.map((a) => (
          <li
            key={a.bookingId}
            className="flex flex-col gap-2 rounded-md bg-[var(--destructive)]/10 p-2 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p>
              <span className="font-medium">{a.unit}</span> ·{" "}
              <span className="tabular">
                {formatDate(a.checkIn)} → {formatDate(a.checkOut)}
              </span>
              {a.guest && ` · ${a.guest}`} ·{" "}
              <Link href={`/bookings/${a.bookingId}`} className="underline underline-offset-2">
                {a.bookingNumber}
              </Link>
            </p>
            <Button type="button" size="sm" disabled={busy === a.bookingId} onClick={() => done(a)}>
              <Check className="size-4" />
              Done - blocked on Airbnb
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
