"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dubaiToday, nightsBetween } from "@/lib/calendar";
import { flushEmailsSoon } from "@/lib/notify/flush";
import { parseAirbnbReservationPage, type AirbnbReservationPage } from "@/lib/airbnb/reservation-page";
import { explain } from "../explain";

export type CapturedBooking = {
  id: string;
  number: string;
  unitId: string;
  checkIn: string;
  checkOut: string;
  guestName: string | null;
  status: string;
};

export type Capture =
  | { error: string }
  | {
      page: AirbnbReservationPage;
      /** The portal's booking for this reservation, if it has one. */
      booking: CapturedBooking | null;
      /** The unit, from that booking or the listing name on the page. */
      unitId: string | null;
    };

/**
 * Reads the text of an Airbnb reservation page and finds where it belongs:
 * the booking with its confirmation code (the calendar sync records codes),
 * else the unit whose Airbnb listing name appears on the page. Nothing is
 * saved here - staff check the values first.
 */
export async function readAirbnbPage(text: string, url: string | null): Promise<Capture> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) return { error: "You do not have permission to add bookings." };
  if (typeof text !== "string" || text.trim().length < 20) {
    return { error: "Nothing came from the page. Open the reservation on Airbnb and try again." };
  }

  const page = parseAirbnbReservationPage(text.slice(0, 100_000), url, dubaiToday());
  const supabase = await createClient();

  type Row = {
    id: string;
    booking_number: string;
    unit_id: string;
    check_in: string;
    check_out: string;
    status: string;
    guests: { full_name: string } | null;
  };
  const columns = "id, booking_number, unit_id, check_in, check_out, status, guests(full_name)";
  let row: Row | null = null;

  if (page.code) {
    const { data } = await supabase
      .from("bookings")
      .select(columns)
      .eq("channel", "airbnb")
      .eq("external_booking_id", page.code)
      .order("created_at", { ascending: false })
      .limit(5);
    const rows = (data ?? []) as Row[];
    row = rows.find((b) => b.status !== "cancelled") ?? rows[0] ?? null;
  }

  let unitId = row?.unit_id ?? null;
  if (!unitId) {
    // The listing's title as Airbnb shows it (matched once, on the import page).
    const { data: units } = await supabase
      .from("units")
      .select("id, airbnb_listing_name")
      .eq("is_active", true)
      .not("airbnb_listing_name", "is", null);
    const lower = text.toLowerCase();
    const hit = (units ?? [])
      .filter((u) => u.airbnb_listing_name && lower.includes(u.airbnb_listing_name.trim().toLowerCase()))
      .sort((a, b) => b.airbnb_listing_name!.length - a.airbnb_listing_name!.length)[0];
    unitId = hit?.id ?? null;
  }

  if (!row && unitId && page.checkIn && page.checkOut) {
    // Synced before its code was known: same unit, same dates.
    const { data } = await supabase
      .from("bookings")
      .select(columns)
      .eq("unit_id", unitId)
      .eq("channel", "airbnb")
      .eq("check_in", page.checkIn)
      .eq("check_out", page.checkOut)
      .neq("status", "cancelled")
      .limit(1);
    row = ((data ?? []) as Row[])[0] ?? null;
  }

  return {
    page,
    unitId,
    booking: row
      ? {
          id: row.id,
          number: row.booking_number,
          unitId: row.unit_id,
          checkIn: row.check_in,
          checkOut: row.check_out,
          guestName: row.guests?.full_name ?? null,
          status: row.status,
        }
      : null,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
const money = z.coerce.number().min(0).max(10_000_000).default(0);
const count = (min: number) => z.coerce.number().int().min(min).max(30);

const saveSchema = z
  .object({
    bookingId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    unitId: z.string().uuid("Choose the unit"),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .max(20)
      .optional()
      .transform((v) => v || undefined),
    checkIn: isoDate,
    checkOut: isoDate,
    guestName: z.string().trim().max(160).optional(),
    adults: count(1).default(1),
    children: count(0).default(0),
    infants: count(0).default(0),
    roomFee: money,
    cleaningFee: money,
    hostServiceFee: money,
    occupancyTaxes: money,
    payout: money,
  })
  .refine((v) => v.checkOut > v.checkIn, { message: "Check-out must be after check-in.", path: ["checkOut"] });

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Saves a reservation read from Airbnb: the guest and the money on the
 * booking the calendar sync made (its dates stay the feed's), or a new
 * Airbnb booking when the portal does not have it yet.
 */
export async function saveAirbnbReservation(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) return { error: "You do not have permission to add bookings." };

  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const input = parsed.data;
  const supabase = await createClient();

  let existing: { id: string; unit_id: string; guest_id: string | null; check_in: string; check_out: string; guests: { full_name: string } | null } | null =
    null;
  if (input.bookingId) {
    const { data } = await supabase
      .from("bookings")
      .select("id, unit_id, guest_id, check_in, check_out, guests(full_name)")
      .eq("id", input.bookingId)
      .maybeSingle();
    if (!data) return { error: "That booking is no longer in the portal. Reload the page." };
    existing = data;
  }

  // A guest per stay, as the earnings import does: a guest record another
  // booking may share is never renamed.
  let guestId = existing?.guest_id ?? null;
  const name = input.guestName?.trim();
  if (name && name.length >= 2 && name.toLowerCase() !== existing?.guests?.full_name?.trim().toLowerCase()) {
    const { data: guest, error: guestError } = await supabase
      .from("guests")
      .insert({ full_name: name })
      .select("id")
      .single();
    if (guestError) return { error: `Could not save the guest: ${guestError.message}` };
    guestId = guest.id;
  }

  const nights = nightsBetween(existing?.check_in ?? input.checkIn, existing?.check_out ?? input.checkOut);
  // Same columns as the earnings import: the guest total includes Tourism
  // Dirham; the payout is what Airbnb pays after its host fee.
  const payout = input.payout || round2(input.roomFee + input.cleaningFee - input.hostServiceFee);
  // The host service fee, else what the room and cleaning come to over the
  // payout: Airbnb's fee line is not always read off the page, the payout is.
  const commission =
    input.hostServiceFee > 0 || !input.payout || input.roomFee <= 0
      ? input.hostServiceFee
      : Math.max(0, round2(input.roomFee + input.cleaningFee - input.payout));
  const amounts =
    input.roomFee > 0 || payout > 0
      ? {
          accommodation_aed: input.roomFee,
          nightly_rate_aed: nights > 0 && input.roomFee > 0 ? round2(input.roomFee / nights) : null,
          cleaning_fee_aed: input.cleaningFee,
          extra_fees_aed: 0,
          tourism_dirham_aed: input.occupancyTaxes,
          channel_commission_aed: commission,
          gross_total_aed: round2(input.roomFee + input.cleaningFee + input.occupancyTaxes),
          payout_expected_aed: payout > 0 ? payout : null,
        }
      : {};
  const guestsCount = {
    adults: input.adults,
    children: input.children,
    infants: input.infants,
    guest_count_known: true,
  };

  let bookingId: string;
  if (existing) {
    const { error } = await supabase
      .from("bookings")
      .update({
        guest_id: guestId,
        ...guestsCount,
        ...amounts,
        ...(input.code ? { external_booking_id: input.code } : {}),
      })
      .eq("id", existing.id);
    if (error) return { error: explain(error) };
    bookingId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("bookings")
      .insert({
        booking_number: "", // set by the autonumber trigger
        unit_id: input.unitId,
        channel: "airbnb",
        status: input.checkOut <= dubaiToday() ? "checked_out" : "confirmed",
        check_in: input.checkIn,
        check_out: input.checkOut,
        external_booking_id: input.code ?? null,
        guest_id: guestId,
        ...guestsCount,
        ...amounts,
        internal_notes: "Added from the Airbnb reservation page.",
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error) return { error: explain(error) };
    bookingId = data.id;
    flushEmailsSoon();
  }

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath(`/units/${existing?.unit_id ?? input.unitId}`);
  redirect(`/bookings/${bookingId}`);
}
