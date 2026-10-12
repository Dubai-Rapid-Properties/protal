import type { Enums, TablesInsert } from "@/lib/db/database.types";

export type LeadStage = Enums<"lead_stage">;
export type LeadIntent = Enums<"lead_intent">;

export const LEAD_STAGES: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  viewing_scheduled: "Viewing scheduled",
  application: "Application",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export const LEAD_INTENTS: Record<LeadIntent, string> = {
  buy_secondary: "Buy",
  buy_off_plan: "Buy off-plan",
  long_term_rent: "Rent",
  short_term_stay: "Holiday stay",
  sell: "Sell",
  property_management: "Property management",
  interior_design: "Fit-out / furnishing",
};

export const OPEN_STAGES: LeadStage[] = [
  "new",
  "contacted",
  "qualified",
  "viewing_scheduled",
  "application",
  "negotiation",
];

/**
 * Website forms that are not sales enquiries: job applications (with a CV)
 * and newsletter sign-ups stay email-only.
 */
const NOT_LEADS = new Set(["careers", "newsletter"]);

/** The website's form ids that always mean one thing. */
const FORM_INTENT: Record<string, LeadIntent> = {
  "book-a-stay": "short_term_stay",
  "off-plan-interest": "buy_off_plan",
  "list-your-property": "sell",
  "property-valuation": "sell",
  "property-management": "property_management",
  "holiday-homes-list": "property_management",
  "fit-out": "interior_design",
  "drp-furnishing": "interior_design",
};

const text = (v: unknown, max = 500): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** What a free-text "interest" or "looking to" answer is about. */
function intentFromText(value: string | null): LeadIntent | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/off.?plan/.test(v)) return "buy_off_plan";
  if (/holiday|short.?(term|stay)|stay/.test(v)) return "short_term_stay";
  if (/rent|lease/.test(v)) return "long_term_rent";
  if (/sell|valuation/.test(v)) return "sell";
  if (/manage/.test(v)) return "property_management";
  if (/fit.?out|furnish|interior/.test(v)) return "interior_design";
  if (/buy|purchase|invest/.test(v)) return "buy_secondary";
  return null;
}

const isoDate = (v: unknown): string | null => {
  const s = text(v, 40);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return s.slice(0, 10);
};

/**
 * Turns a D|R|P website form submission (the fields its /api/enquiry route
 * receives) into a lead. Returns null for forms that are not leads, or when
 * there is no way to contact the person.
 */
export function leadFromWebsite(data: Record<string, unknown>): TablesInsert<"leads"> | null {
  const form = text(data.form, 60) ?? "website";
  if (NOT_LEADS.has(form)) return null;

  const email = text(data.email, 200);
  const phone = text(data.phone, 40);
  if (!email && !phone) return null;
  const name = text(data.name, 200) ?? email ?? phone!;

  const intent =
    FORM_INTENT[form] ??
    intentFromText(text(data.interest) ?? text(data.lookingTo) ?? text(data.listingTitle)) ??
    "buy_secondary";

  const guests = Number.parseInt(String(data.guests ?? ""), 10);
  const area = text(data.area, 80);

  return {
    source: "website",
    stage: "new",
    intent,
    full_name: name,
    email,
    phone,
    preferred_areas: area && !/^any/i.test(area) ? [area] : null,
    stay_check_in: intent === "short_term_stay" ? isoDate(data.checkIn) : null,
    stay_check_out: intent === "short_term_stay" ? isoDate(data.checkOut) : null,
    party_size: intent === "short_term_stay" && Number.isFinite(guests) && guests > 0 ? guests : null,
    notes: text(data.message, 5000),
    raw_payload: data as TablesInsert<"leads">["raw_payload"],
  };
}

/** "listingRef" -> "Listing ref", "book-a-stay" -> "Book a stay" */
export function humanise(key: string): string {
  const t = key.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).replace(/\bdrp\b/gi, "DRP");
}
