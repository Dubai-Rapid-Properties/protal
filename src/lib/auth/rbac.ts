import type { Enums } from "@/lib/db/database.types";

export type Role = Enums<"app_role">;

/**
 * The UI permission matrix.
 *
 * This mirrors the RLS policies in 0010_rls.sql, but it is NOT the security
 * boundary - it decides what to render and which routes to offer. The database
 * refuses anything this layer would wrongly allow. Keep the two in step: if a
 * capability is added here, the matching policy must exist in SQL.
 */
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  property_manager: "Property Manager",
  agent: "Leasing / Sales Agent",
  owner: "Owner",
  tenant: "Tenant",
  guest: "Guest",
  maintenance: "Maintenance / Housekeeping",
  finance: "Accountant / Finance",
  marketing: "Marketing / Admin Support",
};

export type Capability =
  // Property & units
  | "units.view"
  | "units.manage"
  | "properties.manage"
  // Owners
  | "owners.view"
  | "owners.manage"
  | "owners.bank_details"
  // Leasing
  | "leases.view"
  | "leases.manage"
  | "ejari.manage"
  // Short term
  | "bookings.view"
  | "bookings.manage"
  | "permits.manage"
  | "housekeeping.view"
  | "housekeeping.manage"
  // Finance
  | "finance.view"
  | "finance.manage"
  | "statements.view"
  | "statements.issue"
  // Maintenance
  | "maintenance.view"
  | "maintenance.raise"
  | "maintenance.assign"
  | "maintenance.approve_owner"
  // Guest incidents (mess, damage ...): staff only, never owners
  | "incidents.view"
  | "incidents.report"
  // Documents & compliance
  | "documents.view"
  | "documents.upload"
  | "compliance.view"
  // Website listings (sale and rental, shown on the D|R|P website)
  | "website.manage"
  // CRM & comms
  | "leads.manage"
  | "messages.send"
  // Admin
  | "settings.manage"
  | "users.manage"
  | "audit.view";

const ALL: Capability[] = [
  "units.view", "units.manage", "properties.manage",
  "owners.view", "owners.manage", "owners.bank_details",
  "leases.view", "leases.manage", "ejari.manage",
  "bookings.view", "bookings.manage", "permits.manage",
  "housekeeping.view", "housekeeping.manage",
  "finance.view", "finance.manage", "statements.view", "statements.issue",
  "maintenance.view", "maintenance.raise", "maintenance.assign", "maintenance.approve_owner",
  "incidents.view", "incidents.report",
  "documents.view", "documents.upload", "compliance.view",
  "website.manage",
  "leads.manage", "messages.send",
  "settings.manage", "users.manage", "audit.view",
];

export const CAPABILITIES: Record<Role, Capability[]> = {
  super_admin: ALL,

  property_manager: [
    "units.view", "units.manage", "properties.manage",
    "owners.view", "owners.manage",
    "leases.view", "leases.manage", "ejari.manage",
    "bookings.view", "bookings.manage", "permits.manage",
    "housekeeping.view", "housekeeping.manage",
    "finance.view", "statements.view",
    "maintenance.view", "maintenance.raise", "maintenance.assign",
    "incidents.view", "incidents.report",
    "documents.view", "documents.upload", "compliance.view",
    "website.manage",
    "leads.manage", "messages.send",
  ],

  agent: [
    "units.view",
    "owners.view",
    "leases.view", "leases.manage",
    "bookings.view", "bookings.manage",
    "maintenance.view", "maintenance.raise",
    "incidents.view", "incidents.report",
    "documents.view", "documents.upload",
    "website.manage",
    "leads.manage", "messages.send",
  ],

  // Owners get a read-only portal - properties, calendars, stays - plus
  // approval rights over spend on their own units and the ability to request
  // work. Never income: no statements, no ledger, no lease rent (0014).
  owner: [
    "units.view",
    "bookings.view",
    "maintenance.view", "maintenance.raise", "maintenance.approve_owner",
    "documents.view",
    "compliance.view",
  ],

  tenant: [
    "leases.view",
    "maintenance.view", "maintenance.raise",
    "documents.view",
  ],

  guest: [
    "bookings.view",
    "maintenance.raise",
  ],

  maintenance: [
    "units.view",
    "housekeeping.view", "housekeeping.manage",
    "maintenance.view", "maintenance.raise", "maintenance.assign",
    "incidents.view", "incidents.report",
    "documents.view", "documents.upload",
  ],

  // Full financial access, no property CRUD.
  finance: [
    "units.view",
    "owners.view", "owners.manage", "owners.bank_details",
    "leases.view",
    "bookings.view",
    "finance.view", "finance.manage", "statements.view", "statements.issue",
    "maintenance.view",
    "incidents.view",
    "documents.view", "documents.upload", "compliance.view",
    "audit.view",
  ],

  // Listing content and media only - never financials.
  marketing: [
    "units.view",
    "bookings.view",
    "documents.view", "documents.upload",
    "website.manage",
    "leads.manage", "messages.send",
  ],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function canAny(role: Role | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

/** Back-office roles land on the staff dashboard; everyone else on a portal. */
export const STAFF_ROLES: Role[] = [
  "super_admin",
  "property_manager",
  "agent",
  "finance",
  "marketing",
  "maintenance",
];

export function isStaff(role: Role | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export function homePathForRole(role: Role | null | undefined): string {
  if (!role) return "/login";
  if (isStaff(role)) return "/dashboard";
  if (role === "owner") return "/portal/owner";
  // Tenant and guest portals are disabled; those accounts cannot sign in.
  return "/auth/signout?reason=no_access";
}
