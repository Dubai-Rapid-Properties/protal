import { Sidebar } from "@/components/layout/sidebar";
import { HistoryNav } from "@/components/layout/history-nav";
import { AirbnbBlockAlarmBanner } from "@/components/layout/airbnb-block-alarm";
import { StayAlarmBanner } from "@/components/layout/stay-alarm";
import { NotificationSetup } from "@/components/layout/notification-setup";
import { STAFF_NAV } from "@/components/layout/nav";
import { requirePortalProfile } from "@/lib/auth/session";
import { unreadNotificationCount } from "@/lib/notify/count";
import { signOut } from "@/app/login/actions";

/**
 * Back-office shell, served on the admin host only. A non-staff session that
 * somehow reaches it is signed out rather than shown an empty admin screen.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, unread] = await Promise.all([
    requirePortalProfile("admin"),
    unreadNotificationCount(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        sections={STAFF_NAV}
        role={profile.role}
        userName={profile.full_name || profile.email || "User"}
        signOutAction={signOut}
        badges={{ "/notifications": unread }}
      />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        {/* An account with alarms off (0045) gets notifications only */}
        {profile.role === "super_admin" && !profile.alarms_off && <AirbnbBlockAlarmBanner />}
        {(profile.role === "super_admin" || profile.role === "maintenance") && !profile.alarms_off && (
          <StayAlarmBanner />
        )}
        <NotificationSetup
          alarms={(profile.role === "super_admin" || profile.role === "maintenance") && !profile.alarms_off}
        />
        <HistoryNav />
        {children}
      </main>
    </div>
  );
}
