/**
 * Reads the admin team's bookings sheet (Google Sheets, shared "anyone with
 * the link can view") and works out which portal unit and booking each row
 * is. Pure functions: src/lib/sheet/sync.ts applies the result.
 *
 * The sheet's columns, matched by their header:
 *   GUEST | Activity type | Check IN | Check OUT | Location | Apartment Number
 *   | Source | Comments
 * plus, optionally, "Direct Booking Rate (night)" (AED a night) and "Check IN
 * time" / "Check OUT time" (early check-in, late check-out, e.g. 10:00).
 */
import { parseCsv } from "@/lib/airbnb/earnings-csv";
import { rangesOverlap } from "@/lib/calendar";

export type SheetStatus = "upcoming" | "hosting" | "completed" | "cancelled";
export type SheetChannel = "direct" | "airbnb" | "booking_com";

export interface SheetRow {
  /** Row number on the sheet (the header is row 1). */
  line: number;
  guest: string;
  status: SheetStatus;
  checkIn: string;
  checkOut: string;
  location: string;
  apartment: string;
  /** null: a stay from the current Airbnb account, which its calendar feed brings. */
  channel: SheetChannel | null;
  ownerStay: boolean;
  checkInTime: string | null;
  checkOutTime: string | null;
  /** AED a night, from the rate column; null when empty. */
  nightlyRate: number | null;
  /** The check-out comes from the "Extended Dates" column. */
  extended?: boolean;
  /** "Moved Location" / "Moved Apartment Number": where the guest stays instead; empty when not moved. */
  movedLocation?: string;
  movedApartment?: string;
  comments: string;
  /** What the comment says to do (readComment). */
  note?: SheetComment;
}

/**
 * What a row's comment asks for, as the team writes it:
 *   "moved to Seven 1134", "to be moved to cloud 405", "shift to PT 3407"
 *   "originally booked in cloud 2704 shift to Apex 1907"
 *   "Extension paid 6.5K", "extn 3700aed", "Extended until Nov 20",
 *   "paid one night through airbnb, rest will pay directly"
 *   "paid via stripe", "arrived 3:15am"
 * Anything else stays a note on the booking.
 */
export interface SheetComment {
  /** Where the guest is moved to, when the "Moved" columns are empty. */
  movedTo?: { location: string; apartment: string };
  /** Where the stay was booked before the move. */
  bookedIn?: { location: string; apartment: string };
  /** AED for the extra nights of an extension. */
  extensionTotal?: number;
  /** The stay runs past what the channel holds (an extension, or nights paid directly). */
  extends?: boolean;
  /** How a direct guest paid: "Stripe", "cash"... */
  paidVia?: string;
  /** Arrival time, HH:MM. */
  arrivedAt?: string;
  /** Mentions a move the comment does not say where to. */
  unclear?: string;
}

/** Short names the team uses for buildings. */
const PLACE_ALIASES: Record<string, string> = { pt: "Palm Tower", st: "Sparkle Towers", dpt: "Damac Park Tower" };

/** "Seven 1134", "cloud 405", "PT 3407", "Apex 1907/nov15-30" -> building and apartment. */
function place(text: string): { location: string; apartment: string } | undefined {
  const m = text.match(/^\s*(?:the\s+)?([a-z][a-z .'&-]*?)\s*#?\s*([a-z]?\d{2,5}[a-z]?)\b/i);
  if (!m) return undefined;
  const location = m[1].trim();
  return { location: PLACE_ALIASES[location.toLowerCase()] ?? location, apartment: m[2] };
}

/** "6.5K" -> 6500, "3700aed" -> 3700, "3,700" -> 3700. */
function amountOf(text: string): number | undefined {
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : undefined;
}

export function readComment(comment: string): SheetComment {
  const c = comment.replace(/\s+/g, " ").trim();
  const out: SheetComment = {};
  if (!c) return out;

  const booked = c.match(/originally\s+booked\s+(?:in|at)\s+(.+?)(?:\s+(?:and\s+)?(?:shift|shifted|moved|move|transferred)\b|[,;]|$)/i);
  if (booked) out.bookedIn = place(booked[1]);
  const moved = c.match(/(?:moved|move|shift(?:ed)?|transferred|relocated)\s+to\s+(.+)$/i);
  if (moved) out.movedTo = place(moved[1]);
  if (/\b(moved|shift(ed)?|relocat)/i.test(c) && !out.movedTo) out.unclear = "mentions a move but not where to";

  const ext = c.match(/\b(?:extension|extn|ext)\b\s*(?:paid|price|cost|of|for|=|:)?\s*(?:aed\s*)?(\d[\d,.]*\s*(?:k\b)?)/i);
  if (ext) out.extensionTotal = amountOf(ext[1]);
  if (/\b(extend|extension|extn)|rest\s+(?:will\s+)?pay|pay(?:ing|s)?\s+direct/i.test(c)) out.extends = true;

  const paid = c.match(/\bpaid\s+(?:via|by|with|in|through)\s+(stripe|cash|card|bank\s*transfer|transfer|payment\s*link|link)\b/i);
  if (paid) {
    const how = paid[1].toLowerCase().replace(/\s+/g, " ");
    out.paidVia = how === "stripe" ? "Stripe" : how.includes("link") ? "payment link" : how;
  }

  const arrived = c.match(/\barriv\w*\s+(?:at\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/i);
  if (arrived) out.arrivedAt = parseSheetTime(arrived[1]) ?? undefined;
  return out;
}

export interface SheetParseResult {
  rows: SheetRow[];
  problems: string[];
}

/** The CSV export address of a sheet, from its ID or any of its links. */
export function sheetCsvUrl(idOrUrl: string): string {
  const id = idOrUrl.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? idOrUrl.trim();
  const gid = idOrUrl.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "28-Apr-2026", "28 Apr 2026", "2026-04-28" or "28/04/2026" (day first). */
export function parseSheetDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number | undefined, d: number;
  let match = v.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3,9})[-\s/.,]+(\d{4})$/);
  if (match) {
    [d, m, y] = [Number(match[1]), MONTHS[match[2].slice(0, 3).toLowerCase()], Number(match[3])];
  } else if ((match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  if (!m) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "540", "1,150.62", "AED 233.33" -> the amount; empty, zero or text -> null. */
export function parseSheetAmount(value: string): number | null {
  const v = value.replace(/aed|dhs?|,|\s/gi, "");
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Math.round(Number(v) * 100) / 100;
  return n > 0 && n < 1_000_000 ? n : null;
}

/** "10:00", "9:30", "10am", "4 PM" -> "HH:MM"; anything else null. */
export function parseSheetTime(value: string): string | null {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let h = Number(match[1]);
  const min = Number(match[2] ?? 0);
  if (match[3] === "pm" && h < 12) h += 12;
  if (match[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function statusOf(value: string): SheetStatus | null {
  const v = value.trim().toLowerCase();
  if (/cancel/.test(v)) return "cancelled";
  if (/hosting|current|in.?house/.test(v)) return "hosting";
  if (/complete|checked.?out/.test(v)) return "completed";
  if (/upcoming|confirm|future/.test(v)) return "upcoming";
  return null;
}

/** Where the guest booked. Comments name Booking.com guests entered as private. */
function channelOf(source: string, comments: string): SheetChannel | null {
  const s = source.trim().toLowerCase();
  if (/airbnb/.test(s) && !/old/.test(s)) return null;
  if (/booking\.?com/.test(s) || /booking\.?com/i.test(comments)) return "booking_com";
  if (/airbnb/.test(s)) return "airbnb";
  return "direct";
}

export function parseBookingsSheet(text: string): SheetParseResult {
  const all = parseCsv(text);
  const problems: string[] = [];
  // The header is the first row naming the check-in and check-out columns (a title row may come first).
  const isHeader = (r: string[]) => r.some((h) => /^check\s*-?\s*in$/i.test(h.trim())) && r.some((h) => /^check\s*-?\s*out$/i.test(h.trim()));
  const start = Math.max(0, all.slice(0, 10).findIndex(isHeader));
  const table = all.slice(start);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (test: RegExp) => header.findIndex((h) => test.test(h));
  // The guest's name: "GUEST", or a column left with Google Sheets' own name ("Column 1").
  const guestCol = col(/^guest|^name$|guest name/) >= 0 ? col(/^guest|^name$|guest name/) : col(/^column\s*1$/);
  const at = {
    guest: guestCol,
    status: col(/activity|status/),
    checkIn: col(/^check\s*-?\s*in$/),
    checkOut: col(/^check\s*-?\s*out$/),
    location: col(/^(?!moved).*(location|building|property)/),
    apartment: col(/^(?!moved).*(apartment|unit)/),
    source: col(/source|channel/),
    comments: col(/comment|note/),
    checkInTime: col(/^check\s*-?\s*in.*time/),
    checkOutTime: col(/^check\s*-?\s*out.*time/),
    rate: col(/rate|price/),
    extended: col(/extend/),
    movedLocation: col(/moved.*(location|building)/),
    movedApartment: col(/moved.*(apartment|unit)/),
  };
  for (const key of ["guest", "checkIn", "checkOut", "apartment"] as const) {
    if (at[key] < 0) return { rows: [], problems: [`The sheet has no "${key}" column; nothing was read.`] };
  }
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  const rows: SheetRow[] = [];
  table.slice(1).forEach((r, i) => {
    const line = start + i + 2;
    const guest = cell(r, at.guest).replace(/\s+/g, " ");
    const apartment = cell(r, at.apartment);
    const checkInText = cell(r, at.checkIn);
    const checkOutText = cell(r, at.checkOut);
    if (!guest && !apartment && !checkInText) return;
    const status = statusOf(cell(r, at.status)) ?? "upcoming";
    const checkIn = parseSheetDate(checkInText);
    const booked = parseSheetDate(checkOutText);
    // "Extended Dates": the check-out after an extension, when later than the one booked.
    const extended = parseSheetDate(cell(r, at.extended));
    const checkOut = booked && extended && extended > booked ? extended : booked;
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      // Finished or cancelled stays are history: not worth a warning.
      if (status === "upcoming" || status === "hosting") {
        problems.push(`Row ${line} (${guest || "no name"}): check-in/check-out dates not readable.`);
      }
      return;
    }
    const comments = cell(r, at.comments);
    const channel = channelOf(cell(r, at.source), comments);
    const note = readComment(comments);
    // The "Moved" columns win; a comment saying where the guest moved fills them in.
    const movedApartment = cell(r, at.movedApartment) || note.movedTo?.apartment || "";
    const movedLocation = cell(r, at.movedApartment) ? cell(r, at.movedLocation) : note.movedTo?.location ?? cell(r, at.movedLocation);
    rows.push({
      line,
      guest,
      status,
      checkIn,
      checkOut,
      location: cell(r, at.location),
      apartment,
      channel,
      // "OWNER STAY" as the comment, on a stay not from the Airbnb account
      // (a comment merely mentioning an owner stay is not one).
      ownerStay: channel !== null && /^\s*owner'?s?\s*stay\b/i.test(comments),
      checkInTime: parseSheetTime(cell(r, at.checkInTime)) ?? note.arrivedAt ?? null,
      checkOutTime: parseSheetTime(cell(r, at.checkOutTime)),
      nightlyRate: parseSheetAmount(cell(r, at.rate)),
      extended: Boolean(booked && extended && extended > booked),
      movedLocation,
      movedApartment,
      comments,
      note,
    });
  });
  return { rows, problems };
}

/* -------------------------------------------------------------------------- */
/*  Units                                                                      */
/* -------------------------------------------------------------------------- */

export interface PortalUnit {
  id: string;
  unitNumber: string;
  propertyName: string;
}

/** Words that say nothing about which building it is. */
const FILLER = new Set([
  "the", "dubai", "tower", "towers", "by", "at", "one", "apartment", "apartments", "hotel", "and",
  "jvt", "tiger", "properties", "marina", "meydan", "resort", "residence", "residences", "building",
]);

/** A building's telling words: "Al Hallawi, Shoreline 14" -> hallawi, shoreline. */
function buildingWords(name: string): Set<string> {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !FILLER.has(w) && !/^\d+$/.test(w))
    .map((w) => w.replace(/s$/, ""));
  // The Palm Tower is the St. Regis residences (One Serendra on some listings).
  if (words.includes("regi") || words.includes("serendra")) words.push("palm");
  return new Set(words);
}

/** "208 Shoreline" -> 208, "2704B" -> 2704, "B3302" -> 3302, "m20" -> 20. */
export function apartmentKey(value: string): string | null {
  return value.match(/\d+/)?.[0]?.replace(/^0+(?=\d)/, "") ?? null;
}

/**
 * The portal unit a row means: same apartment number and a building that
 * shares a telling word with the row's location. Never a guess: an unknown
 * or ambiguous building matches nothing.
 */
export function matchUnit(row: Pick<SheetRow, "location" | "apartment">, units: PortalUnit[]): PortalUnit | null {
  const key = apartmentKey(row.apartment);
  if (!key) return null;
  const words = buildingWords(`${row.location} ${row.apartment.replace(/\d+/g, " ")}`);
  const scored = units
    .filter((u) => apartmentKey(u.unitNumber) === key)
    .map((u) => ({ u, score: [...buildingWords(u.propertyName)].filter((w) => words.has(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].u;
}

/* -------------------------------------------------------------------------- */
/*  Bookings                                                                   */
/* -------------------------------------------------------------------------- */

export interface PortalBooking {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  guestName: string | null;
  sheetName: string | null;
  icalUid: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  price?: StayPrice;
  /** The booking's internal notes, where the sheet's comment is kept. */
  notes?: string | null;
  /** The unit whose calendar feed a moved stay belongs to (0069). */
  movedFrom?: string | null;
}

/** A booking's price columns, as AED. */
export interface StayPrice {
  nightlyRate: number | null;
  accommodation: number;
  cleaning: number;
  extra: number;
  tourism: number;
  commission: number;
  gross: number;
  payout: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The price of a stay at the sheet's nightly rate: the nights, nothing on top. */
export function sheetPrice(rate: number, nights: number): StayPrice {
  const total = round2(rate * nights);
  return { nightlyRate: rate, accommodation: total, cleaning: 0, extra: 0, tourism: 0, commission: 0, gross: total, payout: total };
}

/**
 * The sheet's rate may price a booking that has no price yet, or one priced
 * by the rate alone before (by the sheet, or by hand the same way). A price
 * with fees, commission or a channel payout was entered on purpose - from
 * the reservation or the earnings export - and is left alone.
 */
export function sheetMayPrice(p: StayPrice | undefined): boolean {
  if (!p || !p.payout) return true;
  return (
    p.cleaning === 0 &&
    p.extra === 0 &&
    p.tourism === 0 &&
    p.commission === 0 &&
    Math.abs(p.gross - p.accommodation) < 0.01 &&
    Math.abs(p.payout - p.gross) < 0.01
  );
}

/** Does the booking already carry this price? */
export const samePrice = (a: StayPrice | undefined, b: StayPrice) =>
  Boolean(a) && a!.nightlyRate === b.nightlyRate && Math.abs(a!.accommodation - b.accommodation) < 0.01 && a!.payout === b.payout;

export const sheetName = (guest: string) => guest.toLowerCase().replace(/\s+/g, " ").trim();
const firstName = (name: string | null) => (name ?? "").toLowerCase().match(/[\p{L}]+/u)?.[0] ?? "";

/**
 * The portal booking a row is, among one unit's bookings: one this sync made
 * or took over before (same sheet name, overlapping or sharing a date), else
 * one typed in by hand for the same stay (overlapping, and the same first
 * name or the same check-in or check-out). Bookings from a channel's
 * calendar feed are never taken: that feed decides their dates. A cancelled
 * booking can be the match - the sync then leaves it be.
 */
export function matchBooking(row: SheetRow, bookings: PortalBooking[]): PortalBooking | null {
  const near = (b: PortalBooking) =>
    rangesOverlap(b.checkIn, b.checkOut, row.checkIn, row.checkOut) ||
    b.checkIn === row.checkIn ||
    b.checkOut === row.checkOut;
  const live = (b: PortalBooking) => (b.status === "cancelled" || b.status === "no_show" ? 1 : 0);
  const byCloseness = (a: PortalBooking, b: PortalBooking) =>
    live(a) - live(b) ||
    Number(b.checkIn === row.checkIn) - Number(a.checkIn === row.checkIn) ||
    Number(b.checkOut === row.checkOut) - Number(a.checkOut === row.checkOut);

  const name = sheetName(row.guest);
  const own = bookings.filter((b) => b.sheetName === name && near(b)).sort(byCloseness);
  if (own.length) return own[0];

  const first = firstName(row.guest);
  const typed = bookings
    .filter(
      (b) =>
        !b.icalUid &&
        !b.sheetName &&
        rangesOverlap(b.checkIn, b.checkOut, row.checkIn, row.checkOut) &&
        ((first.length >= 3 && firstName(b.guestName) === first) ||
          b.checkIn === row.checkIn ||
          b.checkOut === row.checkOut)
    )
    .sort(byCloseness);
  return typed[0] ?? null;
}

/** The line in a booking's notes that carries the sheet's comment. */
export const COMMENT_PREFIX = "Bookings sheet:";
const CREATED_NOTE = "From the bookings sheet.";

/**
 * A booking's notes with the sheet's current comment on its own line, the
 * comment before replaced. Staff's own notes stay as they are. Notes the sync
 * wrote before this ("From the bookings sheet. <comment>") lose the old comment.
 */
export function notesWithComment(notes: string | null, comment: string): string | null {
  const lines = (notes ?? "")
    .split("\n")
    .filter((l) => !l.startsWith(COMMENT_PREFIX))
    .map((l) => (l.startsWith(CREATED_NOTE) ? CREATED_NOTE : l));
  if (comment.trim()) lines.push(`${COMMENT_PREFIX} ${comment.trim()}`);
  return lines.join("\n").trim() || null;
}
