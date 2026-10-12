import type { Enums } from "@/lib/db/database.types";

/**
 * Human labels for database enums, in one place.
 *
 * Everything user-facing routes through here rather than hardcoding strings in
 * components, which is also the seam an Arabic translation layer plugs into:
 * swap these maps for a locale-aware lookup and the whole UI follows.
 */

type LabelMap<T extends string> = Record<T, string>;

export const UNIT_STATUS: LabelMap<Enums<"unit_status">> = {
  vacant: "Vacant",
  occupied_long_term: "Occupied (long-term)",
  listed_short_term: "Listed (short-term)",
  under_maintenance: "Under maintenance",
  owner_occupied: "Owner occupied",
  off_market: "Off market",
};

export const OPERATING_MODE: LabelMap<Enums<"operating_mode">> = {
  long_term: "Long-term lease",
  short_term: "Holiday home",
  both: "Dual mode",
  not_operating: "Not operating",
};

export const UNIT_KIND: LabelMap<Enums<"unit_kind">> = {
  apartment: "Apartment",
  studio: "Studio",
  villa: "Villa",
  townhouse: "Townhouse",
  penthouse: "Penthouse",
  duplex: "Duplex",
  loft: "Loft",
  office: "Office",
  retail: "Retail",
};

export const PROPERTY_KIND: LabelMap<Enums<"property_kind">> = {
  building: "Building",
  villa_compound: "Villa compound",
  standalone_villa: "Standalone villa",
  townhouse_cluster: "Townhouse cluster",
  mixed_use: "Mixed use",
};

export const FURNISHING: LabelMap<Enums<"furnishing_status">> = {
  unfurnished: "Unfurnished",
  semi_furnished: "Semi-furnished",
  fully_furnished: "Fully furnished",
};

export const LEASE_STATUS: LabelMap<Enums<"lease_status">> = {
  draft: "Draft",
  pending_signature: "Pending signature",
  active: "Active",
  expiring: "Expiring",
  renewed: "Renewed",
  terminated: "Terminated",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const EJARI_STATUS: LabelMap<Enums<"ejari_status">> = {
  not_registered: "Not registered",
  pending: "Registration pending",
  registered: "Registered",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const PAYMENT_METHOD: LabelMap<Enums<"rent_payment_method">> = {
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  direct_debit: "Direct debit (UAEDDS)",
  cash: "Cash",
  card: "Card",
  online: "Online",
};

export const INSTALLMENT_STATUS: LabelMap<Enums<"installment_status">> = {
  scheduled: "Scheduled",
  presented: "Presented",
  cleared: "Cleared",
  bounced: "Bounced",
  part_paid: "Part paid",
  cancelled: "Cancelled",
  written_off: "Written off",
};

export const DEPOSIT_STATUS: LabelMap<Enums<"deposit_status">> = {
  not_collected: "Not collected",
  held: "Held",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  forfeited: "Forfeited",
};

export const BOOKING_STATUS: LabelMap<Enums<"booking_status">> = {
  inquiry: "Enquiry",
  tentative: "Tentative",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No show",
};

export const PERMIT_STATUS: LabelMap<Enums<"permit_status">> = {
  draft: "Draft",
  pending: "Pending",
  active: "Active",
  expired: "Expired",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

export const SALES_CHANNEL: LabelMap<Enums<"sales_channel">> = {
  direct: "Direct",
  airbnb: "Airbnb",
  booking_com: "Booking.com",
  vrbo: "Vrbo",
  expedia: "Expedia",
  agoda: "Agoda",
  tripadvisor: "Tripadvisor",
  other: "Other",
};

export const MAINTENANCE_STATUS: LabelMap<Enums<"maintenance_status">> = {
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  awaiting_quote: "Awaiting quote",
  awaiting_owner_approval: "Awaiting owner approval",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  closed: "Closed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const MAINTENANCE_PRIORITY: LabelMap<Enums<"maintenance_priority">> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  emergency: "Emergency",
};

export const MAINTENANCE_CATEGORY: LabelMap<Enums<"maintenance_category">> = {
  air_conditioning: "Air conditioning",
  plumbing: "Plumbing",
  electrical: "Electrical",
  appliance: "Appliance",
  carpentry: "Carpentry",
  painting: "Painting",
  pest_control: "Pest control",
  cleaning: "Cleaning",
  pool: "Pool",
  landscaping: "Landscaping",
  fire_safety: "Fire safety",
  lift: "Lift",
  handyman: "Handyman",
  structural: "Structural",
  noise: "Noise",
  neighbours: "Neighbours",
  security: "Security",
  internet_tv: "Internet / TV",
  service: "Service",
  other: "Other",
};

/** Repairs and complaints share one queue; `kind` tells them apart. */
export const TICKET_KIND = { repair: "Repair", complaint: "Complaint" } as const;
export type TicketKind = keyof typeof TICKET_KIND;

/** The categories offered for each kind of ticket, most common first. */
export const TICKET_CATEGORIES: Record<TicketKind, Enums<"maintenance_category">[]> = {
  repair: [
    "air_conditioning", "plumbing", "electrical", "appliance", "carpentry", "painting",
    "pest_control", "lift", "pool", "landscaping", "fire_safety", "structural", "handyman", "other",
  ],
  complaint: ["noise", "cleaning", "neighbours", "security", "internet_tv", "service", "other"],
};

/** What a guest did to a unit (0033). Staff only - never shown to owners. */
export const INCIDENT_CATEGORY = {
  vomit: "Vomit / bodily fluids",
  mess: "Excessive mess or stains",
  damage: "Damage",
  smoking: "Smoking",
  party_noise: "Party / noise",
  extra_guests: "Extra guests",
  pets: "Pets",
  missing_items: "Missing items",
  rule_breach: "Other house-rule breach",
  other: "Other",
} as const;
export type IncidentCategory = keyof typeof INCIDENT_CATEGORY;

export const INCIDENT_STATUS = { open: "Open", resolved: "Resolved" } as const;
export type IncidentStatus = keyof typeof INCIDENT_STATUS;

export const INVOICE_STATUS: LabelMap<Enums<"invoice_status">> = {
  draft: "Draft",
  issued: "Issued",
  part_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
  written_off: "Written off",
};

export const STATEMENT_STATUS: LabelMap<Enums<"statement_status">> = {
  draft: "Draft",
  issued: "Issued",
  approved: "Approved",
  paid: "Paid",
  void: "Void",
};

export const DOCUMENT_KIND: LabelMap<Enums<"document_kind">> = {
  title_deed: "Title Deed",
  ejari_certificate: "Ejari certificate",
  tenancy_contract: "Tenancy contract",
  det_permit: "DET holiday home permit",
  building_noc: "Building NOC",
  management_agreement: "Management agreement",
  insurance_policy: "Insurance policy",
  emirates_id: "Emirates ID",
  passport: "Passport",
  visa: "Visa",
  trade_licence: "Trade licence",
  bank_letter: "Bank letter",
  invoice: "Invoice",
  receipt: "Receipt",
  owner_statement: "Owner statement",
  service_charge_invoice: "Service charge invoice",
  dewa_bill: "DEWA bill",
  inspection_report: "Inspection report",
  handover_report: "Handover report",
  floor_plan: "Floor plan",
  photo: "Photo",
  poa: "Power of attorney",
  cheque_copy: "Cheque copy",
  other: "Other",
};

export const COMPLIANCE_KIND: LabelMap<Enums<"compliance_kind">> = {
  ejari_expiry: "Ejari expiry",
  ejari_occupant_declaration: "Ejari occupant declaration",
  det_permit_expiry: "DET permit expiry",
  building_noc_expiry: "Building NOC expiry",
  management_agreement_expiry: "Management agreement expiry",
  insurance_expiry: "Insurance expiry",
  emirates_id_expiry: "Emirates ID expiry",
  passport_expiry: "Passport expiry",
  trade_licence_expiry: "Trade licence expiry",
  lease_expiry: "Tenancy expiry",
  preventive_maintenance: "Preventive maintenance",
  vehicle_registration: "Vehicle registration",
  vehicle_insurance: "Vehicle insurance",
  document_expiry: "Document expiry",
};

export const EMIRATE: LabelMap<Enums<"emirate">> = {
  dubai: "Dubai",
  abu_dhabi: "Abu Dhabi",
  sharjah: "Sharjah",
  ajman: "Ajman",
  umm_al_quwain: "Umm Al Quwain",
  ras_al_khaimah: "Ras Al Khaimah",
  fujairah: "Fujairah",
};

export const LEAD_STAGE: LabelMap<Enums<"lead_stage">> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  viewing_scheduled: "Viewing scheduled",
  application: "Application",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

/** Turns any snake_case enum value into something readable as a last resort. */
export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Options list for a <Select>, preserving the map's declared order. */
export function optionsFrom<T extends string>(
  map: LabelMap<T>
): { value: T; label: string }[] {
  return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value] }));
}

/**
 * Narrows an untrusted query-string value to a known enum member.
 *
 * Search params are user input; the Supabase client's types (rightly) refuse a
 * bare string for an enum column, and passing an unknown value through would
 * produce a Postgres error rather than an empty result.
 */
export function parseEnum<T extends string>(
  map: LabelMap<T>,
  value: string | undefined | null
): T | undefined {
  if (!value) return undefined;
  return value in map ? (value as T) : undefined;
}
