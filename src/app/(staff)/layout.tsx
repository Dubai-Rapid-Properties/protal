import { Sidebar } from "@/components/layout/sidebar";
import { HistoryNav } from "@/components/layout/history-nav";
import { AirbnbBlockAlarmBanner } from "@/components/layout/airbnb-block-alarm";
import { StayAlarmBanner } from "@/components/layout/stay-alarm";
import { PhoneAlarmSetup } from "@/components/layout/phone-alarm-setup";
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
        {profile.role === "super_admin" && <AirbnbBlockAlarmBanner />}
        {(profile.role === "super_admin" || profile.role === "maintenance") && (
          <>
            <StayAlarmBanner />
            <PhoneAlarmSetup />
          </>
        )}
        <HistoryNav />
        {children}
      </main>
    </div>
  );
}
