"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The browser's Navigation API, where there is one (Chrome, Edge). */
interface NavigationLike {
  canGoBack: boolean;
  canGoForward: boolean;
}

/**
 * Back and forward, like the browser's own buttons. The portal is installed
 * as an app (manifest display: standalone), which has no browser bar, so
 * every page carries these.
 */
export function HistoryNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [can, setCan] = React.useState({ back: false, forward: false });

  React.useEffect(() => {
    const nav = (window as Window & { navigation?: NavigationLike }).navigation;
    setCan(
      nav && "canGoBack" in nav
        ? { back: nav.canGoBack, forward: nav.canGoForward }
        : { back: window.history.length > 1, forward: true }
    );
  }, [pathname]);

  return (
    <div className="mb-3 flex items-center gap-1 print:hidden">
      <Button type="button" variant="ghost" size="sm" disabled={!can.back} onClick={() => router.back()}>
        <ChevronLeft className="size-4" />
        Back
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={!can.forward} onClick={() => router.forward()}>
        Forward
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
