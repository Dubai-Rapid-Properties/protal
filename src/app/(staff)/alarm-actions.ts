"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";

export interface AirbnbBlockAlarm {
  bookingId: string;
  bookingNumber: string;
  unitId: string;
  unit: string;
  guest: string | null;
  checkIn: string;
  checkOut: string;
}

/**
 * Website bookings whose dates nobody has blocked on Airbnb yet (0037).
 * Super admins only; everyone else gets an empty list.
 */
export async function getAirbnbBlockAlarms(): Promise<AirbnbBlockAlarm[]> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("pending_airbnb_blocks");
  // The generated types leave function results untyped; this is its row.
  const rows = (data ?? []) as unknown as {
    booking_id: string;
    booking_number: string;
    unit_id: string;
    unit_label: string;
    guest_name: string | null;
    check_in: string;
    check_out: string;
  }[];
  return rows.map((r) => ({
    bookingId: r.booking_id,
    bookingNumber: r.booking_number,
    unitId: r.unit_id,
    unit: r.unit_label,
    guest: r.guest_name,
    checkIn: r.check_in,
    checkOut: r.check_out,
  }));
}

/** "Done - blocked on Airbnb": stops the alarm for this booking. */
export async function markAirbnbBlocked(bookingId: string): Promise<{ error?: string }> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") return { error: "Only a super admin can do this." };
  if (!z.string().uuid().safeParse(bookingId).success) return { error: "Booking not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_airbnb_blocked", { p_booking_id: bookingId });
  if (error) return { error: error.message };
  revalidatePath(`/bookings/${bookingId}`);
  return {};
}
