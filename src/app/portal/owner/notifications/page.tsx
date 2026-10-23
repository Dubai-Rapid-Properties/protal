import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/domain/shared";
import { NotificationList } from "@/components/domain/notification-list";
import { TestNotificationButton } from "@/components/domain/test-notification-button";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  // RLS returns only the signed-in user's own notifications; the layout has
  // already checked they belong on this portal.
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="New, changed and cancelled bookings."
        actions={<TestNotificationButton />}
      />
      <NotificationList rows={data ?? []} />
    </>
  );
}
