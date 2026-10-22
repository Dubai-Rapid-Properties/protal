"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { getVapidKeys, pushConfirmation } from "@/lib/push/stay-alarms";

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
  /** "prepare": the guest arrives tomorrow; housekeeping gets the unit ready (0044). */
  kind: "check_out" | "check_in" | "prepare";
  /** 1 = an hour ahead (or, for "prepare", from 16:00 the day before), 2 = on the time. */
  stage: 1 | 2;
  /** Dubai time of the check-out or check-in, e.g. "12:00". */
  dueAt: string;
}

const STAY_ALARM_ROLES = new Set(["super_admin", "maintenance"]);

/**
 * Today's check-outs (rings 11:00 and 12:00) and check-ins (14:00 and 15:00),
 * Dubai time, that nobody has answered yet (0042), and for housekeeping,
 * tomorrow's check-ins from 16:00 (0044). Super admins and housekeeping only;
 * everyone else gets an empty list.
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
  kind: z.enum(["check_out", "check_in", "prepare"]),
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

/** The key a device subscribes to push with; null for people the alarm is not for. */
export async function getPushPublicKey(): Promise<string | null> {
  const profile = await requireProfile();
  if (!STAY_ALARM_ROLES.has(profile.role)) return null;
  return (await getVapidKeys(createAdminClient())).publicKey;
}

const pushSubscription = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/**
 * Turns the check-out / check-in alarm on for this device (0043). When
 * `confirm`, sends it a "Phone alarm is on" notification to prove it arrives;
 * otherwise it only re-saves the device for whoever is signed in on it now.
 */
export async function savePushSubscription(
  subscription: unknown,
  userAgent: string,
  confirm: boolean
): Promise<{ error?: string }> {
  const profile = await requireProfile();
  if (!STAY_ALARM_ROLES.has(profile.role)) return { error: "Only a super admin or housekeeping can do this." };
  const parsed = pushSubscription.safeParse(subscription);
  if (!parsed.success) return { error: "This browser gave an unusable push address." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: userAgent.slice(0, 300),
  });
  if (error) return { error: error.message };
  return confirm ? pushConfirmation(createAdminClient(), parsed.data.endpoint) : {};
}
