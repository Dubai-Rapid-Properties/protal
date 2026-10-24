"use client";

import { Button } from "@/components/ui/button";

/**
 * Shown when a page could not be built, for instance because the database did not answer. The person
 * is still signed in: trying again is all that is needed.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--muted)] p-4">
      <div className="w-full max-w-sm rounded-lg border bg-[var(--background)] p-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          The page could not load, usually because the connection dropped for a moment. You are still signed in.
        </p>
        <Button className="mt-4" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
