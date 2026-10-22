import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { addDays, dubaiToday, rangesOverlap } from "@/lib/calendar";
import {
  matchBooking,
  matchUnit,
  parseBookingsSheet,
  sheetCsvUrl,
  sheetName,
  type PortalBooking,
  type PortalUnit,
  type SheetRow,
} from "./bookings-sheet";

type Client = SupabaseClient<Database>;

export interface SheetSyncResult {
  ok: boolean;
  rowsRead: number;
  created: number;
  updated: number;
  cancelled: number;
  problems: string[];
}

const TIMEOUT_MS = 15_000;
const SHEET_NOTE = "From the bookings sheet";

async function fetchSheet(idOrUrl: string): Promise<string> {
  const response = await fetch(sheetCsvUrl(idOrUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "text/csv" },
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("text/csv")) {
    throw new Error(
      `The sheet could not be read (HTTP ${response.status}). Share it as "Anyone with the link can view".`
    );
  }
  return response.text();
}

const label = (row: SheetRow) => `Row ${row.line} (${row.guest || "no name"}, ${row.location} ${row.apartment})`;

/**
 * Brings the bookings sheet's stays from today on into the portal (0049).
 * The sheet decides the dates and cancellations of the bookings it made or
 * took over; a booking cancelled in the portal stays cancelled, and stays
 * from the current Airbnb account are left to their calendar feed. Rows it
 * cannot place are reported, never guessed.
 */
export async function syncBookingsSheet(client: Client, idOrUrl: string): Promise<SheetSyncResult> {
  const result: SheetSyncResult = { ok: true, rowsRead: 0, created: 0, updated: 0, cancelled: 0, problems: [] };
  const problem = (text: string) => result.problems.push(text);
  const today = dubaiToday();

  try {
    const parsed = parseBookingsSheet(await fetchSheet(idOrUrl));
    result.rowsRead = parsed.rows.length;
    parsed.problems.forEach(problem);

    const [{ data: unitRows, error: unitError }, { data: previous }] = await Promise.all([
      client
        .from("units")
        .select("id, unit_number, properties(name)")
        .eq("is_active", true)
        .in("operating_mode", ["short_term", "both"]),
      client.from("bookings_sheet_sync").select("id").maybeSingle(),
    ]);
    if (unitError) throw new Error(unitError.message);
    const units: PortalUnit[] = (unitRows ?? []).map((u) => ({
      id: u.id,
      unitNumber: u.unit_number,
      propertyName: u.properties?.name ?? "",
    }));
    // The first read records what the sheet holds without announcing it.
    const firstRead = !previous;

    const bookingsOf = new Map<string, PortalBooking[]>();
    const loadBookings = async (unitId: string) => {
      if (!bookingsOf.has(unitId)) {
        const { data, error } = await client
          .from("bookings")
          .select("id, status, check_in, check_out, check_in_time, check_out_time, sheet_name, ical_uid, guests(full_name)")
          .eq("unit_id", unitId)
          .gte("check_out", addDays(today, -60));
        if (error) throw new Error(error.message);
        bookingsOf.set(
          unitId,
          (data ?? []).map((b) => ({
            id: b.id,
            status: b.status,
            checkIn: b.check_in,
            checkOut: b.check_out,
            guestName: b.guests?.full_name ?? null,
            sheetName: b.sheet_name,
            icalUid: b.ical_uid,
            checkInTime: b.check_in_time?.slice(0, 5) ?? null,
            checkOutTime: b.check_out_time?.slice(0, 5) ?? null,
          }))
        );
      }
      return bookingsOf.get(unitId)!;
    };

    for (const row of parsed.rows) {
      if (row.checkOut < today) continue;
      if (row.channel === null && !row.ownerStay) continue;

      const unit = matchUnit(row, units);
      if (!unit) {
        problem(`${label(row)}: no unit in the portal matches this building and apartment.`);
        continue;
      }
      const unitName = `${unit.propertyName} ${unit.unitNumber}`;

      if (row.ownerStay) {
        await applyOwnerStay(client, row, unit, unitName, result);
        continue;
      }

      const bookings = await loadBookings(unit.id);
      const match = matchBooking(row, bookings);

      if (match) {
        if (match.status === "cancelled" || match.status === "no_show") {
          if (row.status !== "cancelled") {
            problem(`${label(row)}: cancelled in the portal, but still on the sheet as ${row.status}.`);
          }
          continue;
        }
        const changes: Database["public"]["Tables"]["bookings"]["Update"] = {};
        if (!match.sheetName) changes.sheet_name = sheetName(row.guest);
        // A guest already in or gone is not moved or cancelled from the sheet.
        const upcoming = match.status === "confirmed" || match.status === "tentative" || match.status === "inquiry";
        if (!upcoming) {
          // nothing but the sheet name
        } else if (row.status === "cancelled") {
          Object.assign(changes, {
            status: "cancelled",
            cancelled_on: today,
            cancellation_reason: "Cancelled on the bookings sheet",
          });
        } else if (match.checkIn !== row.checkIn || match.checkOut !== row.checkOut) {
          Object.assign(changes, { check_in: row.checkIn, check_out: row.checkOut });
        }
        // Times only when the sheet gives them: staff may have set them here.
        if (row.checkInTime && row.checkInTime !== match.checkInTime) changes.check_in_time = row.checkInTime;
        if (row.checkOutTime && row.checkOutTime !== match.checkOutTime) changes.check_out_time = row.checkOutTime;
        const meaningful = Boolean(changes.status || changes.check_in || changes.check_in_time || changes.check_out_time);
        if (!meaningful && !changes.sheet_name) continue;

        const { error } = await client.from("bookings").update(changes).eq("id", match.id);
        if (error) {
          problem(`${label(row)}: the portal booking could not be updated - ${await explainClash(client, error, unit.id, row)}`);
          continue;
        }
        Object.assign(match, {
          sheetName: changes.sheet_name ?? match.sheetName,
          status: changes.status ?? match.status,
          checkIn: changes.check_in ?? match.checkIn,
          checkOut: changes.check_out ?? match.checkOut,
          checkInTime: changes.check_in_time ?? match.checkInTime,
          checkOutTime: changes.check_out_time ?? match.checkOutTime,
        });
        if (changes.status) result.cancelled++;
        else if (meaningful) result.updated++;
        continue;
      }

      if (row.status === "cancelled") continue;

      const { data: guest, error: guestError } = await client
        .from("guests")
        .insert({ full_name: row.guest || "Guest" })
        .select("id")
        .single();
      if (guestError) {
        problem(`${label(row)}: ${guestError.message}`);
        continue;
      }
      const { data: created, error } = await client
        .from("bookings")
        .insert({
          booking_number: "", // set by the autonumber trigger
          unit_id: unit.id,
          channel: row.channel ?? "direct",
          status: "confirmed",
          check_in: row.checkIn,
          check_out: row.checkOut,
          check_in_time: row.checkInTime,
          check_out_time: row.checkOutTime,
          adults: 1,
          guest_count_known: false,
          guest_id: guest.id,
          sheet_name: sheetName(row.guest),
          internal_notes: [`${SHEET_NOTE}.`, row.comments].filter(Boolean).join(" "),
          import_source: firstRead ? "bookings_sheet" : null,
        })
        .select("id")
        .single();
      if (error) {
        await client.from("guests").delete().eq("id", guest.id);
        problem(`${label(row)}: not added to ${unitName} - ${await explainClash(client, error, unit.id, row)}`);
        continue;
      }
      bookingsOf.get(unit.id)?.push({
        id: created.id,
        status: "confirmed",
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        guestName: row.guest,
        sheetName: sheetName(row.guest),
        icalUid: null,
        checkInTime: row.checkInTime,
        checkOutTime: row.checkOutTime,
      });
      result.created++;
    }
  } catch (error) {
    result.ok = false;
    problem(error instanceof Error ? error.message : "The sheet sync failed.");
  }

  await client.from("bookings_sheet_sync").upsert({
    id: true,
    synced_at: new Date().toISOString(),
    ok: result.ok,
    rows_read: result.rowsRead,
    created: result.created,
    updated: result.updated,
    cancelled: result.cancelled,
    problems: result.problems.slice(0, 50),
  });
  return result;
}

/** Owner stays on the sheet ("OWNER STAY" in the comments) are calendar blocks. */
async function applyOwnerStay(
  client: Client,
  row: SheetRow,
  unit: PortalUnit,
  unitName: string,
  result: SheetSyncResult
) {
  const { data: blocks } = await client
    .from("availability_blocks")
    .select("id, start_date, end_date, note")
    .eq("unit_id", unit.id)
    .eq("reason", "owner_stay")
    .lt("start_date", row.checkOut)
    .gt("end_date", row.checkIn);
  const block = blocks?.[0];

  if (row.status === "cancelled") {
    if (block?.note?.startsWith(SHEET_NOTE)) {
      await client.from("availability_blocks").delete().eq("id", block.id);
      result.cancelled++;
    }
    return;
  }
  if (block) {
    if (block.start_date !== row.checkIn || block.end_date !== row.checkOut) {
      const { error } = await client
        .from("availability_blocks")
        .update({ start_date: row.checkIn, end_date: row.checkOut })
        .eq("id", block.id);
      if (error) result.problems.push(`${label(row)}: owner stay not moved - ${error.message}`);
      else result.updated++;
    }
    return;
  }

  const { data: clash } = await client
    .from("bookings")
    .select("booking_number, check_in, check_out")
    .eq("unit_id", unit.id)
    .in("status", ["tentative", "confirmed", "checked_in"])
    .lt("check_in", row.checkOut)
    .gt("check_out", row.checkIn)
    .limit(1);
  if (clash?.length) {
    const b = clash[0];
    result.problems.push(
      `${label(row)}: owner stay not added to ${unitName} - booking ${b.booking_number} (${b.check_in} to ${b.check_out}) is in these dates.`
    );
    return;
  }
  const { error } = await client.from("availability_blocks").insert({
    unit_id: unit.id,
    reason: "owner_stay",
    start_date: row.checkIn,
    end_date: row.checkOut,
    note: `${SHEET_NOTE}: ${row.guest}`,
  });
  if (error) result.problems.push(`${label(row)}: owner stay not added - ${error.message}`);
  else result.created++;
}

/** Names the booking in the way, or says what the database refused. */
async function explainClash(
  client: Client,
  error: { code?: string; message: string },
  unitId: string,
  row: SheetRow
): Promise<string> {
  if (error.message.includes("no valid DET holiday home permit")) return "the unit has no valid DET permit for these dates.";
  if (error.code !== "23P01") return error.message;
  const { data } = await client
    .from("bookings")
    .select("booking_number, check_in, check_out, guests(full_name)")
    .eq("unit_id", unitId)
    .in("status", ["tentative", "confirmed", "checked_in"])
    .lt("check_in", row.checkOut)
    .gt("check_out", row.checkIn)
    .limit(1);
  const b = data?.[0];
  return b && rangesOverlap(b.check_in, b.check_out, row.checkIn, row.checkOut)
    ? `it overlaps ${b.booking_number}${b.guests?.full_name ? ` (${b.guests.full_name})` : ""}, ${b.check_in} to ${b.check_out}.`
    : "it overlaps another booking.";
}
