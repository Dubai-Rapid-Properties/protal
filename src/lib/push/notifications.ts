import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { deliver, getVapidKeys } from "./stay-alarms";

type Client = SupabaseClient<Database>;

type Row = {
  notification_id: string;
  title: string;
  body: string;
  link: string | null;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Pushes every portal notification not sent yet to its recipient's devices,
 * as a phone notification (0051). Each is claimed once, so two runs at once
 * never send it twice. Called right after the actions and syncs that make
 * notifications, and every two minutes by the scheduler for anything missed.
 */
export async function pushNotifications(admin: Client) {
  const { data, error } = await admin.rpc("claim_notification_pushes");
  if (error) throw new Error(error.message);
  // The generated types leave function results untyped; this is its row.
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return { sent: 0, gone: 0, failed: 0 };

  const keys = await getVapidKeys(admin);
  const results = await Promise.all(
    rows.map((r) =>
      deliver(
        admin,
        keys,
        { id: r.subscription_id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth },
        // The link is a path in the recipient's own portal, and the device
        // signed up on that portal's address.
        { title: r.title, body: r.body, tag: `notification-${r.notification_id}`, url: r.link ?? "/" },
        // A phone that is off gets it when it is back, within a day.
        86_400
      )
    )
  );
  return {
    sent: results.filter((r) => r === "sent").length,
    gone: results.filter((r) => r === "gone").length,
    failed: results.filter((r) => typeof r === "object").length,
  };
}
