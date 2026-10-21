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

export interface StayAlarm {
  bookingId: string;
  bookingNumber: string;
  unitId: string;
  unit: string;
  guest: string | null;
  kind: "check_out" | "check_in";
  /** 1 = an hour ahead, 2 = on the time. */
  stage: 1 | 2;
  /** Dubai time of the check-out or check-in, e.g. "12:00". */
  dueAt: string;
}

const STAY_ALARM_ROLES = new Set(["super_admin", "maintenance"]);

/**
 * Today's check-outs (rings 11:00 and 12:00) and check-ins (14:00 and 15:00),
 * Dubai time, that nobody has answered yet (0042). Super admins and
 * housekeeping only; everyone else gets an empty list.
 */
export async function getStayAlarms(): Promise<StayAlarm[]> {
  const profile = await requireProfile();
  if (!STAY_ALARM_ROLES.has(profile.role)) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("due_stay_alarms");
  // The generated types leave function results untyped; this is its row.
  const rows = (data ?? []) as unknown as {
    booking_id: string;
    booking_number: string;
    unit_id: string;
    unit_label: string;
    guest_name: string | null;
    kind: StayAlarm["kind"];
    stage: StayAlarm["stage"];
    due_at: string;
  }[];
  return rows.map((r) => ({
    bookingId: r.booking_id,
    bookingNumber: r.booking_number,
    unitId: r.unit_id,
    unit: r.unit_label,
    guest: r.guest_name,
    kind: r.kind,
    stage: r.stage,
    dueAt: r.due_at,
  }));
}

const stayAlarmAck = z.object({
  bookingId: z.string().uuid(),
  kind: z.enum(["check_out", "check_in"]),
  stage: z.union([z.literal(1), z.literal(2)]),
});

/** "Done": stops this ring. The ring on the time still sounds after the hour-ahead one. */
export async function ackStayAlarm(alarm: Pick<StayAlarm, "bookingId" | "kind" | "stage">): Promise<{ error?: string }> {
  const profile = await requireProfile();
  if (!STAY_ALARM_ROLES.has(profile.role)) return { error: "Only a super admin or housekeeping can do this." };
  const parsed = stayAlarmAck.safeParse(alarm);
  if (!parsed.success) return { error: "Booking not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ack_stay_alarm", {
    p_booking_id: parsed.data.bookingId,
    p_kind: parsed.data.kind,
    p_stage: parsed.data.stage,
  });
  if (error) return { error: error.message };
  return {};
}
