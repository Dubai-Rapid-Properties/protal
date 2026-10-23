import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { env } from "@/lib/env";
import { generateVapidKeys, sendPush, type PushTarget, type VapidKeys } from "./webpush";

type Client = SupabaseClient<Database>;

/** What the service worker (public/sw.js) shows. */
export interface PushMessage {
  title: string;
  body: string;
  /** One notification per ring: a repeat replaces it and rings again. */
  tag: string;
  url: string;
  /** Present on alarms: the "Done" button answers this ring (or these, for tomorrow's check-ins). */
  ack?: Ack | Ack[];
}

type Kind = "check_out" | "check_in" | "prepare";
type Ack = { bookingId: string; kind: Kind; stage: 1 | 2 };

type Ring = {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  booking_id: string;
  booking_number: string;
  unit_label: string;
  kind: Kind;
  stage: 1 | 2;
  due_at: string;
};

/** Push services want a way to reach the sender: the portal's address. */
const subject = () => (env.adminUrl.startsWith("https://") ? env.adminUrl : "mailto:office@dubairapidproperties.com");

/**
 * The portal's push signing key. Made on first use and kept in the database
 * (0043), so there is nothing to configure; every device subscribes with its
 * public half. Needs the service key.
 */
export async function getVapidKeys(admin: Client): Promise<VapidKeys> {
  const read = () => admin.from("push_vapid_keys").select("public_key, private_key").maybeSingle();
  let { data } = await read();
  if (!data) {
    const fresh = await generateVapidKeys();
    // Two first calls at once: the second insert is ignored and both read the winner.
    await admin
      .from("push_vapid_keys")
      .upsert({ id: true, public_key: fresh.publicKey, private_key: fresh.privateKey }, { ignoreDuplicates: true });
    ({ data } = await read());
  }
  if (!data) throw new Error("Could not create the push key");
  return { publicKey: data.public_key, privateKey: data.private_key };
}

/**
 * Tomorrow's check-ins, as one notification per phone: housekeeping gets the
 * units ready the day before, and "Done" answers them all.
 */
function prepareMessage(rings: Ring[]): PushMessage {
  const units = rings.map((r) => r.unit_label);
  const n = rings.length;
  return {
    title: `Tomorrow: ${n} check-in${n === 1 ? "" : "s"} to get ready`,
    body: units.length > 4 ? `${units.slice(0, 4).join(", ")} and ${units.length - 4} more` : units.join(", "),
    tag: "prepare-tomorrow",
    url: "/bookings",
    ack: rings.map((r) => ({ bookingId: r.booking_id, kind: r.kind, stage: r.stage })),
  };
}

function alarmMessage(r: Ring): PushMessage {
  const what = r.kind === "check_out" ? "Check-out" : "Check-in";
  return {
    title: r.stage === 1 ? `${what} in 1 hour (${r.due_at})` : `${what} now (${r.due_at})`,
    body: `${r.unit_label} · ${r.booking_number}`,
    tag: `stay-${r.booking_id}-${r.kind}-${r.stage}`,
    url: `/bookings/${r.booking_id}`,
    ack: { bookingId: r.booking_id, kind: r.kind, stage: r.stage },
  };
}

/**
 * Sends one message to one device; forgets a device the push service says is
 * gone. The default TTL is short: an alarm that arrives long after the fact
 * helps nobody, and the next run sends it again anyway.
 */
export async function deliver(
  admin: Client,
  keys: VapidKeys,
  target: PushTarget & { id: string },
  message: PushMessage,
  ttlSeconds = 300
) {
  const result = await sendPush(target, message, keys, subject(), { ttlSeconds });
  if (result === "gone") await admin.from("push_subscriptions").delete().eq("id", target.id);
  else if (result === "sent") {
    await admin.from("push_subscriptions").update({ last_sent_at: new Date().toISOString() }).eq("id", target.id);
  }
  return result;
}

/**
 * Pushes every check-out / check-in ring nobody has answered to the phones
 * of everyone who hears it. Called by the scheduler every two minutes, so an
 * unanswered ring repeats until someone presses "Done".
 */
export async function pushStayAlarms(admin: Client) {
  const { data, error } = await admin.rpc("stay_alarm_pushes");
  if (error) throw new Error(error.message);
  // The generated types leave function results untyped; this is its row.
  const rows = (data ?? []) as unknown as Ring[];
  if (rows.length === 0) return { sent: 0, gone: 0, failed: 0, errors: [] as string[] };

  /* Today's check-outs and check-ins one by one; tomorrow's as one list per phone */
  const target = (r: Ring) => ({ id: r.subscription_id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth });
  const prepare = new Map<string, Ring[]>();
  for (const r of rows) if (r.kind === "prepare") prepare.set(r.subscription_id, [...(prepare.get(r.subscription_id) ?? []), r]);
  const messages = [
    ...rows.filter((r) => r.kind !== "prepare").map((r) => [target(r), alarmMessage(r)] as const),
    ...[...prepare.values()].map((rings) => [target(rings[0]), prepareMessage(rings)] as const),
  ];

  const keys = await getVapidKeys(admin);
  const results = await Promise.all(messages.map(([to, message]) => deliver(admin, keys, to, message)));
  const errors = results.flatMap((r) => (typeof r === "object" ? [r.error] : []));
  return {
    sent: results.filter((r) => r === "sent").length,
    gone: results.filter((r) => r === "gone").length,
    failed: errors.length,
    errors: errors.slice(0, 5),
  };
}

/** "Notifications are on": proves the device can be reached, right after it signs up. */
export async function pushConfirmation(admin: Client, endpoint: string, alarms = true) {
  const { data } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (!data) return { error: "Device not saved" };
  const result = await deliver(admin, await getVapidKeys(admin), data, {
    title: "Notifications are on",
    body: alarms
      ? "Bookings and tickets arrive here as they happen, and the check-out / check-in alarm rings until someone presses Done."
      : "New, changed and cancelled bookings arrive here as they happen.",
    tag: "phone-alarm-on",
    url: "/bookings",
  });
  return typeof result === "object" ? result : {};
}
