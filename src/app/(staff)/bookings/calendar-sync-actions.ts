"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isAirbnbCalendarUrl, syncAllUnits, syncUnit, type SyncResult } from "@/lib/ical/sync";
import { flushEmailsSoon } from "@/lib/notify/flush";

export type SyncActionState = { error?: string; success?: string };

const unitId = z.string().uuid();

async function requireManager(): Promise<string | null> {
  const profile = await requireProfile();
  return can(profile.role, "bookings.manage")
    ? null
    : "You do not have permission to manage calendars.";
}

function describe(result: SyncResult): SyncActionState {
  if (!result.ok && !result.created && !result.updated && !result.cancelled) {
    return { error: result.errors[0] ?? "The sync failed." };
  }
  const parts = [
    result.created ? `${result.created} new` : null,
    result.updated ? `${result.updated} changed` : null,
    result.reinstated ? `${result.reinstated} restored` : null,
    result.cancelled ? `${result.cancelled} cancelled` : null,
  ].filter(Boolean);
  const summary = parts.length ? parts.join(", ") : "no changes";
  return result.ok
    ? { success: `Synced with Airbnb: ${summary}.` }
    : { error: `Synced with problems (${summary}): ${result.errors[0]}` };
}

function refresh(id?: string) {
  // A sync can import bookings, and each one queues notification emails.
  flushEmailsSoon();
  if (id) revalidatePath(`/units/${id}`);
  revalidatePath("/bookings");
  revalidatePath("/calendar-sync");
}

/** Saves (or clears) a unit's Airbnb calendar link, then syncs it straight away. */
export async function saveAirbnbLink(
  id: string,
  _prev: SyncActionState,
  formData: FormData
): Promise<SyncActionState> {
  const denied = await requireManager();
  if (denied) return { error: denied };
  if (!unitId.safeParse(id).success) return { error: "Unknown unit." };

  const url = String(formData.get("airbnbIcalUrl") ?? "").trim();
  if (url && !isAirbnbCalendarUrl(url)) {
    return {
      error:
        "That is not an Airbnb calendar link. On Airbnb open the listing's Calendar → Availability → Connect calendars → Export calendar, and copy the link (it starts with https://www.airbnb…).",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .update({
      airbnb_ical_url: url || null,
      ...(url ? {} : { ical_last_status: null, ical_last_error: null, ical_last_synced_at: null }),
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You do not have access to this unit." };

  if (!url) {
    refresh(id);
    return { success: "Airbnb link removed. Imported bookings stay as they are." };
  }

  const result = await syncUnit(supabase, id, url);
  refresh(id);
  const outcome = describe(result);
  return outcome.success ? { success: `Link saved. ${outcome.success}` } : outcome;
}

/** "Sync now" for one unit. */
export async function syncUnitNow(id: string): Promise<SyncActionState> {
  const denied = await requireManager();
  if (denied) return { error: denied };
  if (!unitId.safeParse(id).success) return { error: "Unknown unit." };

  const supabase = await createClient();
  const { data: unit } = await supabase
    .from("units")
    .select("id, airbnb_ical_url")
    .eq("id", id)
    .maybeSingle();
  if (!unit) return { error: "You do not have access to this unit." };
  if (!unit.airbnb_ical_url) return { error: "Add the unit's Airbnb calendar link first." };

  const result = await syncUnit(supabase, id, unit.airbnb_ical_url);
  refresh(id);
  return describe(result);
}

/** "Sync all now" - every unit this user may manage that has a link. */
export async function syncAllNow(): Promise<SyncActionState> {
  const denied = await requireManager();
  if (denied) return { error: denied };

  const supabase = await createClient();
  const results = await syncAllUnits(supabase);
  refresh();

  if (results.length === 0) return { error: "No units have an Airbnb calendar link yet." };
  const failed = results.filter((r) => !r.ok).length;
  const created = results.reduce((n, r) => n + (r.created ?? 0), 0);
  const cancelled = results.reduce((n, r) => n + (r.cancelled ?? 0), 0);
  const summary = `${results.length} ${results.length === 1 ? "unit" : "units"} synced: ${created} new, ${cancelled} cancelled`;
  return failed ? { error: `${summary}. ${failed} had problems - see the table.` } : { success: `${summary}.` };
}

/**
 * Issues a new export link. The old one stops working at once, so it must be
 * pasted into Airbnb again - only worth doing if the link leaked.
 */
export async function regenerateExportLink(id: string): Promise<SyncActionState> {
  const denied = await requireManager();
  if (denied) return { error: denied };
  if (!unitId.safeParse(id).success) return { error: "Unknown unit." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .update({ ical_export_token: randomBytes(32).toString("hex") })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You do not have access to this unit." };

  refresh(id);
  return { success: "New export link created. Paste it into Airbnb - the old one no longer works." };
}

const icalUid = z.string().trim().min(1).max(500);

/** Syncs one unit again after a link changes, so its problem line updates at once. */
async function resync(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<SyncActionState> {
  const { data: unit } = await supabase.from("units").select("airbnb_ical_url").eq("id", id).maybeSingle();
  if (!unit?.airbnb_ical_url) return {};
  return describe(await syncUnit(supabase, id, unit.airbnb_ical_url));
}

/**
 * "This Airbnb stay is that booking": a private guest who booked through
 * Airbnb, already recorded here as a Direct booking. The sync skips the stay
 * from then on instead of reporting it as overlapping (0036).
 */
export async function linkChannelStay(id: string, uid: string, bookingId: string): Promise<SyncActionState> {
  const denied = await requireManager();
  if (denied) return { error: denied };
  if (!unitId.safeParse(id).success || !unitId.safeParse(bookingId).success || !icalUid.safeParse(uid).success) {
    return { error: "Unknown stay." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("link_channel_stay", {
    p_unit_id: id,
    p_channel: "airbnb",
    p_ical_uid: uid,
    p_booking_id: bookingId,
  });
  if (error) return { error: error.message };

  const after = await resync(supabase, id);
  refresh(id);
  return after.error ? { success: "Linked.", ...after } : { success: "Linked. The sync no longer reports this stay." };
}

/** Undoes a link: the Airbnb stay is read again on this sync. */
export async function unlinkChannelStay(id: string, uid: string): Promise<SyncActionState> {
  const denied = await requireManager();
  if (denied) return { error: denied };
  if (!unitId.safeParse(id).success || !icalUid.safeParse(uid).success) return { error: "Unknown stay." };

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("channel_stay_links")
    .delete()
    .eq("unit_id", id)
    .eq("channel", "airbnb")
    .eq("ical_uid", uid)
    .select("ical_uid");
  if (error) return { error: error.message };
  if (!removed?.length) return { error: "This link could not be removed." };

  const after = await resync(supabase, id);
  refresh(id);
  return after.error ? after : { success: "Unlinked. The Airbnb stay is read again." };
}
