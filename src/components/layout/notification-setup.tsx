"use client";

import * as React from "react";
import { BellRing, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPushPublicKey, savePushSubscription } from "@/app/push-actions";
import { fromBase64Url } from "@/lib/push/webpush";

type State = "checking" | "on" | "off" | "denied" | "ios-install" | "unsupported";

const DISMISSED_KEY = "drp-notifications-dismissed";
const DISMISS_FOR_MS = 7 * 24 * 3600_000;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISSED_KEY) ?? 0) < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/**
 * Offers to turn on phone notifications for this device, so portal
 * notifications - and for super admins and housekeeping the check-out /
 * check-in alarm - arrive as the phone's own notification banners with the
 * portal closed (0043, 0051). iPhones only allow that for a portal added to
 * the Home Screen, so there it explains how. Staff and owners alike.
 */
export function NotificationSetup({ alarms = false }: { alarms?: boolean }) {
  const [state, setState] = React.useState<State>("checking");
  const [hidden, setHidden] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setHidden(dismissedRecently());
    // Opening the portal clears the dot on the app icon (public/sw.js sets it).
    (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => {});
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState(isIos() && !installed() ? "ios-install" : "unsupported");
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (existing && Notification.permission === "granted") {
        // Keep the device with whoever is signed in on it now.
        await savePushSubscription(existing.toJSON(), navigator.userAgent, false);
        return setState("on");
      }
      setState(Notification.permission === "denied" ? "denied" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const key = await getPushPublicKey();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(key),
      });
      const result = await savePushSubscription(subscription.toJSON(), navigator.userAgent, true);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Notifications are on for this device.");
        setState("on");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Private mode: it simply shows again next time.
    }
  }

  if (hidden || state === "checking" || state === "on" || state === "unsupported") return null;
  const what = alarms ? "bookings, tickets and the check-out / check-in alarm" : "new, changed and cancelled bookings";

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border bg-[var(--card)] p-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between print:hidden">
      <p className="flex items-start gap-2">
        {state === "ios-install" ? (
          <Smartphone className="mt-0.5 size-4 shrink-0" />
        ) : (
          <BellRing className="mt-0.5 size-4 shrink-0" />
        )}
        <span>
          {state === "off" &&
            `Get ${what} on this device as notifications, like any app's, even when the portal is closed.`}
          {state === "denied" &&
            `Notifications are blocked for the portal on this device. Allow them in the phone or browser settings to get ${what}.`}
          {state === "ios-install" &&
            `To get ${what} on this iPhone with the portal closed: tap Share, then Add to Home Screen. Open the portal from that icon and turn notifications on there.`}
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {state === "off" && (
          <Button type="button" size="sm" disabled={busy} onClick={turnOn}>
            <BellRing className="size-4" />
            Turn on notifications
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={dismiss} aria-label="Not now">
          <X className="size-4" />
          Not now
        </Button>
      </div>
    </div>
  );
}
