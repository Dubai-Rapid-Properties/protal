import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { HistoryNav } from "@/components/layout/history-nav";
import { OWNER_NAV } from "@/components/layout/nav";
import { requirePortalProfile } from "@/lib/auth/session";
import { unreadNotificationCount } from "@/lib/notify/count";
import { signOut } from "@/app/login/actions";
import { env } from "@/lib/env";

/**
 * Owner portal shell, served on the owner host only. Staff sessions never
 * reach it: staff cannot sign in on this host, and any other session found
 * here is signed out. The tenant and guest portals are disabled.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, unread] = await Promise.all([
    requirePortalProfile("owner"),
    unreadNotificationCount(),
  ]);

  // With owner passwords on (env.ownerPasswords): last_login_at is written
  // only by a password sign-in (login/actions) and by setPassword
  // (auth/actions). An owner with a session but no stamp got in through a
  // one-time link without choosing a password, so they choose one before the
  // portal opens - otherwise they could never sign in again. With passwords
  // off, the link is how owners sign in and there is nothing to choose.
  if (env.ownerPasswords && !profile.last_login_at) redirect("/auth/set-password");

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        sections={OWNER_NAV}
        role={profile.role}
        userName={profile.full_name || profile.email || "User"}
        signOutAction={signOut}
        badges={{ "/portal/owner/notifications": unread }}
        showChangePassword={env.ownerPasswords}
      />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <HistoryNav />
        {children}
      </main>
    </div>
  );
}
