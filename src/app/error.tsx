"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Shown when a page could not be built or an action failed. The person is still signed in. Two causes:
 * the database did not answer for a moment (trying again is enough), or this tab was opened before the
 * portal was updated and asks for actions the server no longer has (it needs a reload).
 */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const updated = unstable_isUnrecognizedActionError(error);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--muted)] p-4">
      <div className="w-full max-w-sm rounded-lg border bg-[var(--background)] p-6 text-center">
        <h1 className="text-lg font-semibold">{updated ? "The portal was updated" : "Something went wrong"}</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {updated
            ? "This page was opened before the update. Reload it to carry on. You are still signed in."
            : "The page could not load, usually because the connection dropped for a moment. You are still signed in."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {!updated && <Button onClick={() => reset()}>Try again</Button>}
          <Button variant={updated ? "default" : "outline"} onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </main>
  );
}
