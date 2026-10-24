import { unstable_isUnrecognizedActionError } from "next/navigation";

/**
 * A tab left open across a deploy still holds the old build's server action ids, and the server
 * answers them with 409 "Server Action unavailable". Next.js throws an UnrecognizedActionError for
 * it in the browser. Background polls swallowed that and kept asking every 30 seconds, so the alarms
 * stayed silent and the log filled with 409s. A tab that notices it is out of date says so here, so
 * the polls stop and a notice asks for a reload (never an automatic one: it could wipe a form).
 */
const EVENT = "portal-stale";
let stale = false;

/** True (and the tab is marked out of date) when `error` is an action the server no longer knows. */
export function noteIfStale(error: unknown): boolean {
  if (!unstable_isUnrecognizedActionError(error)) return false;
  if (!stale && typeof window !== "undefined") {
    stale = true;
    window.dispatchEvent(new Event(EVENT));
  }
  return true;
}

export const portalIsStale = () => stale;

export function subscribeToStale(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
