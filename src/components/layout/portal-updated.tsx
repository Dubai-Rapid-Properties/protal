"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { portalIsStale, subscribeToStale } from "@/lib/stale-client";

/** Shown when this tab has noticed the portal was updated since it loaded (see stale-client.ts). */
export function PortalUpdatedNotice() {
  const stale = React.useSyncExternalStore(subscribeToStale, portalIsStale, () => false);
  if (!stale) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-50 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-[var(--warning)] bg-[var(--background)] p-3 shadow-lg print:hidden"
    >
      <p className="text-sm font-medium">
        The portal was updated. Reload this page so the alarms and saving work again. You are still signed in.
      </p>
      <Button size="sm" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
