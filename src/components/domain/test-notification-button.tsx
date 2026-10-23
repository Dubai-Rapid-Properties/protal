"use client";

import * as React from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendTestNotification } from "@/app/push-actions";

/** Sends a test notification to the signed-in user's devices (phone and computer). */
export function TestNotificationButton() {
  const [busy, start] = React.useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const r = await sendTestNotification();
          if (r.devices === 0) {
            toast.error(
              "No device has notifications on for your login. On iPhone: add the portal to the Home Screen, open it from there and turn notifications on."
            );
          } else if (r.sent === r.devices) {
            toast.success(
              `Sent to ${r.devices} device${r.devices === 1 ? "" : "s"}. If it does not show, check Focus and the app's notification settings on that device.`
            );
          } else {
            toast.error(`Sent to ${r.sent} of ${r.devices} devices${r.error ? `: ${r.error}` : ""}.`);
          }
        })
      }
    >
      <BellRing className="size-4" />
      {busy ? "Sending…" : "Send a test notification"}
    </Button>
  );
}
