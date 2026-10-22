import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { parseICal, toAirbnbEvents, ICalError } from "./parse";
import { isAirbnbCalendarUrl } from "./url";

export { isAirbnbCalendarUrl };

type Client = SupabaseClient<Database>;

export interface SyncResult {
  unitId: string;
  ok: boolean;
  created?: number;
  updated?: number;
  reinstated?: number;
  cancelled?: number;
  blocks?: number;
  errors: string[];
}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

/** Downloads a feed, following redirects only while they stay on Airbnb. */
export async function fetchCalendar(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAirbnbCalendarUrl(current)) {
      throw new ICalError("The calendar link must be an https://www.airbnb… iCal export URL.");
    }

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "text/calendar, text/plain;q=0.9", "User-Agent": "DRP-PMS calendar sync" },
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new ICalError(timedOut ? "Airbnb did not answer within 15 seconds." : "Could not reach Airbnb.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ICalError(`Airbnb redirected (HTTP ${response.status}) without a location.`);
      current = new URL(location, current).toString();
      continue;
    }
    if (response.status === 404 || response.status === 410) {
      throw new ICalError("Airbnb says this calendar link does not exist. It may have been reset on Airbnb - copy the export link again.");
    }
    if (!response.ok) throw new ICalError(`Airbnb returned HTTP ${response.status}.`);

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new ICalError("The calendar is unexpectedly large; not imported.");
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new ICalError("The calendar is unexpectedly large; not imported.");
    return text;
  }
  throw new ICalError("Too many redirects from Airbnb.");
}

/**
 * Syncs one unit: fetch and parse its Airbnb feed, then reconcile it in the
 * database with a single apply_airbnb_ical() call - one round trip, one
 * transaction. Failures to fetch or parse are recorded on the unit so the
 * admin screen shows them.
 *
 * Runs with whatever client it is given: the signed-in staff member's for
 * "Sync now" (RLS applies), the service client for the scheduled job.
 */
export async function syncUnit(client: Client, unitId: string, url: string): Promise<SyncResult> {
  let events;
  try {
    events = toAirbnbEvents(parseICal(await fetchCalendar(url)));
  } catch (error) {
    const message = error instanceof ICalError ? error.message : "Unexpected error reading the calendar.";
    await client.rpc("apply_airbnb_ical", { p_unit_id: unitId, p_events: null, p_error: message });
    return { unitId, ok: false, errors: [message] };
  }

  const { data, error } = await client.rpc("apply_airbnb_ical", {
    p_unit_id: unitId,
    p_events: events,
  });
  if (error) return { unitId, ok: false, errors: [error.message] };

  const result = data as unknown as Omit<SyncResult, "unitId">;
  return { unitId, ...result, errors: result.errors ?? [] };
}

/**
 * Units the scheduled run does not start after this long, so the run ends
 * inside the scheduler's 55-second request (scripts/setup-cron.mjs) even when
 * the last units each wait out their 15-second feed timeout.
 */
const RUN_BUDGET_MS = 30_000;

/**
 * Syncs every unit with a feed, the longest-unsynced first. A run that hits
 * its time budget leaves the rest for the next run, which starts with them.
 * In a fixed order the same units at the end of the list missed every run
 * that took too long.
 */
export async function syncAllUnits(
  client: Client,
  concurrency = 4,
  budgetMs = RUN_BUDGET_MS
): Promise<SyncResult[]> {
  const { data: units, error } = await client
    .from("units")
    .select("id, airbnb_ical_url")
    .eq("is_active", true)
    .not("airbnb_ical_url", "is", null)
    .order("ical_last_synced_at", { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);

  const started = Date.now();
  const queue = [...(units ?? [])];
  const results: SyncResult[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let unit = queue.shift(); unit; unit = queue.shift()) {
        if (Date.now() - started > budgetMs) return;
        results.push(await syncUnit(client, unit.id, unit.airbnb_ical_url!));
      }
    })
  );
  return results;
}
