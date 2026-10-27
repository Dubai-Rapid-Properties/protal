"use client";

import * as React from "react";
import { CheckCircle2, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/domain/shared";
import { EXTENSION_VERSION as LATEST_EXTENSION } from "@/lib/airbnb/extension-version";

/** The installed "D|R|P for Airbnb" extension's version, or null (asked through its portal script). */
export function useInstalledExtension(): string | null {
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === window && e.data?.drpExtension === "pong" && typeof e.data.version === "string") {
        setVersion(e.data.version);
      }
    };
    window.addEventListener("message", onMessage);
    // The extension's script may start after this page does: ask a few times.
    const ping = () => window.postMessage({ drpExtension: "ping" }, window.location.origin);
    ping();
    const timers = [300, 1000, 2500].map((ms) => window.setTimeout(ping, ms));
    return () => {
      window.removeEventListener("message", onMessage);
      timers.forEach(clearTimeout);
    };
  }, []);
  return version;
}

const isOlder = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
};

function CopyAddress({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success("Copied. Paste it in the address bar.");
        } catch {
          toast.error("Could not copy. Type it in the address bar.");
        }
      }}
    >
      {text}
      <Copy className="size-3" />
    </button>
  );
}

/**
 * How to get the D|R|P button on Airbnb: the extension, or (Safari, or no
 * extensions allowed) the bookmark button passed as `fallback`.
 */
export function AirbnbExtensionSetup({ fallback }: { fallback: React.ReactNode }) {
  const installed = useInstalledExtension();
  const download = (
    <Button asChild>
      <a href="/units/from-airbnb/extension" download>
        <Download className="size-4" />
        Download the extension (.zip)
      </a>
    </Button>
  );

  if (installed) {
    const old = isOlder(installed, LATEST_EXTENSION);
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-4 text-[var(--success)]" />
          The D|R|P extension is installed on this browser (version {installed}).
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">
          From version 1.1 it also saves a listing&apos;s prices on its unit by itself, whenever the listing&apos;s
          Pricing or Calendar page is open on Airbnb.
        </p>
        {old && (
          <Callout title={`Version ${LATEST_EXTENSION} is out`}>
            <p className="mb-2">
              Download it, replace the files in the <strong>drp-airbnb</strong> folder with the new ones, then click the
              reload arrow on the extension at <CopyAddress text="chrome://extensions" />.
            </p>
            {download}
          </Callout>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-medium">Install the D|R|P extension (once, on each computer: Chrome, Edge or Brave)</p>
      <ol className="list-decimal space-y-1.5 pl-5 text-[var(--muted-foreground)]">
        <li>
          <span className="mb-1.5 block">Download it:</span>
          {download}
        </li>
        <li>
          Open the downloaded file. It unpacks to a folder named <strong>drp-airbnb</strong>: move it to{" "}
          <strong>Documents</strong> and keep it there (the browser runs the extension from it).
        </li>
        <li>
          Open <CopyAddress text="chrome://extensions" /> (in Edge: <CopyAddress text="edge://extensions" />) and turn
          on <strong>Developer mode</strong> (top right).
        </li>
        <li>
          Click <strong>Load unpacked</strong> and choose the <strong>drp-airbnb</strong> folder. Then reload this
          page: it says when the extension is installed.
        </li>
      </ol>
      <details className="rounded-md border border-[var(--border)] p-3">
        <summary className="cursor-pointer font-medium">Safari, or extensions not allowed? Use a bookmark instead</summary>
        <div className="mt-3 space-y-3">{fallback}</div>
      </details>
    </div>
  );
}
