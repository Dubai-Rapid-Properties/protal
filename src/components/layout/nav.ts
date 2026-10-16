import type { Capability } from "@/lib/auth/rbac";

/**
 * Navigation is derived from capabilities, not from role names, so adding a
 * capability to a role in rbac.ts is all it takes for the matching section to
 * appear. Items whose capability the user lacks are never rendered - and the
 * database would refuse the data anyway.
 *
 * Only routes that exist are listed. Phase 2 surfaces still without a screen
 * (housekeeping, the standalone document vault) have
 * their tables, constraints and RLS in place; they are added here as they are
 * built rather than left as dead links.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  capability: Capability;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const STAFF_NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard", capability: "units.view" },
      { label: "Notifications", href: "/notifications", icon: "Bell", capability: "units.view" },
      { label: "Compliance", href: "/compliance", icon: "ShieldCheck", capability: "compliance.view" },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { label: "Properties", href: "/properties", icon: "Building2", capability: "units.view" },
      { label: "Units", href: "/units", icon: "DoorOpen", capability: "units.view" },
      { label: "Owners", href: "/owners", icon: "Users", capability: "owners.view" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Repairs & complaints", href: "/maintenance", icon: "Wrench", capability: "maintenance.view" },
      { label: "Guest incidents", href: "/incidents", icon: "TriangleAlert", capability: "incidents.view" },
    ],
  },
  {
    label: "Leasing",
    items: [
      { label: "Tenancies", href: "/leases", icon: "FileSignature", capability: "leases.view" },
    ],
  },
  {
    label: "Holiday homes",
    items: [
      { label: "Bookings", href: "/bookings", icon: "CalendarDays", capability: "bookings.view" },
      { label: "Calendar", href: "/calendar", icon: "CalendarRange", capability: "bookings.view" },
      { label: "Calendar sync", href: "/calendar-sync", icon: "RefreshCw", capability: "bookings.view" },
    ],
  },
  {
    label: "Website",
    items: [
      { label: "Listings", href: "/website/listings", icon: "Globe", capability: "website.manage" },
      { label: "Team", href: "/website/team", icon: "Users", capability: "website.manage" },
      { label: "Leads", href: "/leads", icon: "Inbox", capability: "leads.manage" },
      { label: "Holiday homes", href: "/website/holiday-homes", icon: "BedDouble", capability: "units.manage" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Ledger", href: "/finance", icon: "Receipt", capability: "finance.view" },
      {
        label: "Owner statements",
        href: "/finance/statements",
        icon: "FileText",
        capability: "statements.view",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Company settings", href: "/settings", icon: "Settings", capability: "settings.manage" },
    ],
  },
];

export const OWNER_NAV: NavSection[] = [
  {
    label: "My portfolio",
    items: [
      { label: "Overview", href: "/portal/owner", icon: "LayoutDashboard", capability: "units.view" },
      { label: "Notifications", href: "/portal/owner/notifications", icon: "Bell", capability: "units.view" },
      { label: "My properties", href: "/portal/owner/units", icon: "Building2", capability: "units.view" },
      { label: "Calendar", href: "/portal/owner/calendar", icon: "CalendarRange", capability: "bookings.view" },
      { label: "Bookings", href: "/portal/owner/bookings", icon: "CalendarDays", capability: "bookings.view" },
      { label: "Repairs & complaints", href: "/portal/owner/maintenance", icon: "Wrench", capability: "maintenance.view" },
      { label: "Documents", href: "/portal/owner/documents", icon: "FolderOpen", capability: "documents.view" },
    ],
  },
];

export const TENANT_NAV: NavSection[] = [
  {
    label: "My tenancy",
    items: [
      { label: "Overview", href: "/portal/tenant", icon: "LayoutDashboard", capability: "leases.view" },
    ],
  },
];

export const GUEST_NAV: NavSection[] = [
  {
    label: "My stay",
    items: [
      { label: "Booking", href: "/portal/guest", icon: "CalendarDays", capability: "bookings.view" },
    ],
  },
];
