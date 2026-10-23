"use server";

import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { deliver, getVapidKeys, pushConfirmation } from "@/lib/push/stay-alarms";

/** Who also gets the check-out / check-in alarm on the phone (0043, 0045). */
const hearsAlarms = (p: { role: string; alarms_off?: boolean | null }) =>
  (p.role === "super_admin" || p.role === "maintenance") && !p.alarms_off;

/** The key a device subscribes to push with. Any signed-in account (0051). */
export async function getPushPublicKey(): Promise<string> {
  await requireProfile();
  return (await getVapidKeys(createAdminClient())).publicKey;
}

const pushSubscription = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/**
 * Turns phone notifications on for this device: every portal notification,
 * and for super admins and housekeeping the check-out / check-in alarm too.
 * When `confirm`, sends a "Notifications are on" notification to prove it
 * arrives; otherwise it only re-saves the device for whoever is signed in on
 * it now.
 */
export async function savePushSubscription(
  subscription: unknown,
  userAgent: string,
  confirm: boolean
): Promise<{ error?: string }> {
  const profile = await requireProfile();
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
  return confirm ? pushConfirmation(createAdminClient(), parsed.data.endpoint, hearsAlarms(profile)) : {};
}

/**
 * Sends a test notification to every device of whoever is signed in, and
 * says how many the push service took. "Taken" means it reached Apple's or
 * Google's servers; if it then does not show, the phone's own settings
 * (Focus, the app's notifications) are holding it back.
 */
export async function sendTestNotification(): Promise<{ devices: number; sent: number; error?: string }> {
  const profile = await requireProfile();
  const admin = createAdminClient();
  const { data: devices, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("profile_id", profile.id);
  if (error) return { devices: 0, sent: 0, error: error.message };
  if (!devices?.length) return { devices: 0, sent: 0 };

  const keys = await getVapidKeys(admin);
  const results = await Promise.all(
    devices.map((d) =>
      deliver(admin, keys, d, {
        title: "Test notification",
        body: "Notifications from the D|R|P portal reach this device.",
        tag: `test-${Date.now()}`,
        url: "/notifications",
      })
    )
  );
  const failed = results.find((r) => typeof r === "object");
  return {
    devices: devices.length,
    sent: results.filter((r) => r === "sent").length,
    error: failed && typeof failed === "object" ? failed.error : undefined,
  };
}
