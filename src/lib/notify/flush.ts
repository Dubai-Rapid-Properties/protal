import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { sendQueuedEmails } from "./email";
import { pushNotifications } from "@/lib/push/notifications";

/**
 * Sends queued booking emails, and pushes new notifications to phones (0051),
 * once the current response has gone out, so the person who saved a booking
 * does not wait on the mail or push services. Anything this misses is picked
 * up by the next scheduled run.
 */
export function flushEmailsSoon(): void {
  if (!env.supabaseServiceRoleKey) return;
  after(async () => {
    try {
      await sendQueuedEmails(createAdminClient());
    } catch (error) {
      console.error("[notify] sending queued emails failed:", error);
    }
    try {
      await pushNotifications(createAdminClient());
    } catch (error) {
      console.error("[notify] pushing notifications failed:", error);
    }
  });
}
