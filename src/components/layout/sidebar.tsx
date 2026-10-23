"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { can, ROLE_LABELS, type Role } from "@/lib/auth/rbac";
import { Logo } from "./logo";
import type { NavSection } from "./nav";

function Icon({ name, className }: { name: string; className?: string }) {
  const Component = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    name
  ];
  return Component ? <Component className={className} /> : null;
}

export function Sidebar({
  sections,
  role,
  userName,
  signOutAction,
  badges = {},
  showChangePassword = true,
}: {
  sections: NavSection[];
  role: Role;
  userName: string;
  signOutAction: () => Promise<void>;
  /** Counts shown beside nav items, keyed by href (e.g. unread notifications). */
  badges?: Record<string, number>;
  /** Off in the owner portal while owners sign in by link only. */
  showChangePassword?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Close the drawer whenever the route changes on mobile.
  React.useEffect(() => setOpen(false), [pathname]);

  const visible = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => can(role, item.capability) && !(role && item.hideFor?.includes(role))),
    }))
    .filter((section) => section.items.length > 0);

  // The deepest item containing the current page is the active one, so a
  // portal's home (/portal/owner) does not light up on every page under it.
  const hrefs = visible.flatMap((section) => section.items.map((item) => item.href));
  const activeHref = hrefs
    .filter((href) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-6">
        <Logo imageClassName="w-32" priority />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {visible.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    // Dynamic routes are not fully prefetched by default.
                    // Forcing it means the next page is already in flight
                    // before the click, so navigation feels immediate even
                    // when the server round trip is not.
                    prefetch
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive(item.href)
                        ? "bg-[var(--primary)] font-medium text-[var(--primary-foreground)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    )}
                  >
                    <Icon name={item.icon} className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {(badges[item.href] ?? 0) > 0 && (
                      <span
                        className="ml-auto rounded-full bg-[var(--destructive)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--destructive-foreground)]"
                        aria-label={`${badges[item.href]} unread`}
                      >
                        {badges[item.href]! > 99 ? "99+" : badges[item.href]}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="mb-2 min-w-0 px-1">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {ROLE_LABELS[role]}
          </p>
        </div>
        {showChangePassword && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="w-full justify-start text-[var(--muted-foreground)]"
          >
            <Link href="/auth/set-password">
              <Icons.KeyRound className="size-4" />
              Change password
            </Link>
          </Button>
        )}
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-[var(--muted-foreground)]"
          >
            <Icons.LogOut className="size-4" />
            Sign out
          </Button>
        </form>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Icons.Menu className="size-5" />
        </Button>
        <Logo imageClassName="w-16" />
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-[var(--border)] bg-[var(--card)] transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {nav}
      </aside>
    </>
  );
}
