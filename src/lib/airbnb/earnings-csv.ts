/**
 * Airbnb's earnings export (Earnings -> Transaction history -> Export CSV),
 * turned into booking amounts.
 *
 * The calendar feed carries dates and the confirmation code, never money, so
 * this is how Airbnb stays get their price: rows are matched to bookings by
 * confirmation code.
 *
 * Only "Reservation" rows are used. Payout rows repeat money already counted,
 * and adjustments or resolution payouts are not the stay's price. A long stay
 * Airbnb pays out in parts appears as several reservation rows with one code;
 * they are summed.
 *
 * Headers are matched loosely (case, spacing and punctuation ignored) because
 * Airbnb has renamed columns over time.
 */

export interface AirbnbEarnings {
  code: string;
  guest: string | null;
  currency: string | null;
  /** What Airbnb paid or will pay out for the stay. */
  amount: number;
  /** Airbnb's host service fee. */
  serviceFee: number;
  cleaningFee: number;
  /** Accommodation plus cleaning, before the host service fee. */
  grossEarnings: number;
  /** Taxes Airbnb collected from the guest (Dubai: Tourism Dirham). */
  occupancyTaxes: number;
  rows: number;
  /** The listing's title, as Airbnb names it in the file. */
  listing: string | null;
  /** Stay dates (ISO), when the file has them. checkOut is the departure day. */
  checkIn: string | null;
  checkOut: string | null;
}

export interface EarningsParseResult {
  reservations: AirbnbEarnings[];
  /** Rows that were not reservations, by type, e.g. { Payout: 4 }. */
  skipped: Record<string, number>;
  errors: string[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const COLUMNS = {
  type: ["type"],
  code: ["confirmationcode", "confirmationnumber", "reservationcode"],
  guest: ["guest", "guestname"],
  currency: ["currency"],
  amount: ["amount", "paidout", "payout"],
  serviceFee: ["servicefee", "hostservicefee", "hostfee"],
  cleaningFee: ["cleaningfee"],
  grossEarnings: ["grossearnings"],
  occupancyTaxes: ["occupancytaxes", "occupancytax", "taxes"],
  listing: ["listing", "listingname", "listingtitle"],
  startDate: ["startdate", "checkin", "checkindate"],
  endDate: ["enddate", "checkout", "checkoutdate"],
  nights: ["nights"],
} as const;

/**
 * Airbnb writes dates as MM/DD/YYYY, but a file opened and re-saved in Excel
 * can come back as DD/MM/YYYY or YYYY-MM-DD. A file is read one way
 * throughout: day-first only if some date cannot be month-first.
 */
function dateReader(samples: string[]): (value: string) => string | null {
  const dayFirst = samples.some((v) => {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    return m !== null && Number(m[1]) > 12;
  });
  return (value) => {
    const v = value.trim();
    let y: number, mo: number, d: number;
    const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (dmy) {
      const [a, b] = [Number(dmy[1]), Number(dmy[2])];
      [mo, d] = dayFirst ? [b, a] : [a, b];
      y = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    } else return null;
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    return date.toISOString().slice(0, 10);
  };
}

const addDaysIso = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "1,234.56", "(12.00)", "-12" and "" as numbers. */
export function parseAmount(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-");
  const digits = trimmed.replace(/[^0-9.]/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseAirbnbEarnings(text: string): EarningsParseResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) {
    return { reservations: [], skipped: {}, errors: ["The file has no rows."] };
  }

  const header = rows[0].map(norm);
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, names]) => [
      key,
      header.findIndex((h) => (names as readonly string[]).includes(h)),
    ])
  ) as Record<keyof typeof COLUMNS, number>;

  if (col.code < 0 || col.amount < 0) {
    return {
      reservations: [],
      skipped: {},
      errors: [
        "This does not look like Airbnb's earnings export: it needs a Confirmation code and an Amount column. " +
          "In Airbnb, open Earnings, then Transaction history, then Export CSV.",
      ],
    };
  }

  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const readDate = dateReader(
    rows.slice(1).flatMap((r) => [cell(r, col.startDate), cell(r, col.endDate)]).filter(Boolean)
  );
  const byCode = new Map<string, AirbnbEarnings>();
  const skipped: Record<string, number> = {};

  for (const r of rows.slice(1)) {
    const type = cell(r, col.type) || "Reservation";
    const code = cell(r, col.code).toUpperCase();
    if (!/^reservation$/i.test(type) || !code) {
      skipped[type] = (skipped[type] ?? 0) + 1;
      continue;
    }

    const checkIn = readDate(cell(r, col.startDate));
    const nights = Number(cell(r, col.nights));
    const checkOut =
      readDate(cell(r, col.endDate)) ??
      (checkIn && Number.isInteger(nights) && nights > 0 ? addDaysIso(checkIn, nights) : null);

    const entry =
      byCode.get(code) ??
      ({
        code,
        guest: cell(r, col.guest) || null,
        listing: cell(r, col.listing).replace(/\s+/g, " ") || null,
        checkIn,
        checkOut: checkIn && checkOut && checkOut > checkIn ? checkOut : null,
        currency: cell(r, col.currency).toUpperCase() || null,
        amount: 0,
        serviceFee: 0,
        cleaningFee: 0,
        grossEarnings: 0,
        occupancyTaxes: 0,
        rows: 0,
      } satisfies AirbnbEarnings);

    entry.amount += parseAmount(cell(r, col.amount));
    entry.serviceFee += Math.abs(parseAmount(cell(r, col.serviceFee)));
    entry.cleaningFee += Math.abs(parseAmount(cell(r, col.cleaningFee)));
    entry.grossEarnings += Math.abs(parseAmount(cell(r, col.grossEarnings)));
    entry.occupancyTaxes += Math.abs(parseAmount(cell(r, col.occupancyTaxes)));
    entry.rows += 1;
    byCode.set(code, entry);
  }

  const reservations = [...byCode.values()].map((e) => ({
    ...e,
    amount: round2(e.amount),
    serviceFee: round2(e.serviceFee),
    cleaningFee: round2(e.cleaningFee),
    // Older exports have no gross column: payout plus the fee is the same thing.
    grossEarnings: round2(e.grossEarnings || e.amount + e.serviceFee),
    occupancyTaxes: round2(e.occupancyTaxes),
  }));

  return { reservations, skipped, errors };
}

/**
 * Booking columns for one Airbnb stay. Consistent with how a hand-entered
 * booking is priced: the guest total includes Tourism Dirham, and the payout
 * is that total less the channel's commission and the Tourism Dirham.
 */
export function earningsToBookingAmounts(e: AirbnbEarnings, nights: number) {
  const accommodation = round2(Math.max(0, e.grossEarnings - e.cleaningFee));
  return {
    accommodation_aed: accommodation,
    nightly_rate_aed: nights > 0 ? round2(accommodation / nights) : null,
    cleaning_fee_aed: e.cleaningFee,
    extra_fees_aed: 0,
    tourism_dirham_aed: e.occupancyTaxes,
    // The service fee, else what the gross comes to over the payout: some
    // exports leave the fee column out, the gross and the amount are there.
    channel_commission_aed: e.serviceFee > 0 ? e.serviceFee : round2(Math.max(0, e.grossEarnings - e.amount)),
    gross_total_aed: round2(e.grossEarnings + e.occupancyTaxes),
    payout_expected_aed: e.amount,
  };
}
