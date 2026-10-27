/**
 * Reads an Airbnb reservation from the text of its page on airbnb.com
 * (Reservations → a reservation), as the "Send to D|R|P" button sends it, or
 * as staff copy and paste it.
 *
 * Airbnb publishes no API for this and changes its page from time to time, so
 * the reader looks for labels ("Check-in", "Host payout", "Cleaning fee"...)
 * rather than for positions, accepts each field missing, and staff check
 * every value before it is saved.
 */

export interface AirbnbReservationPage {
  code: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  /** Host side: the nights before Airbnb's host fee. */
  roomFee: number | null;
  cleaningFee: number | null;
  /** Airbnb's host service fee, as a positive amount. */
  hostServiceFee: number | null;
  /** Taxes Airbnb collected from the guest (Dubai: Tourism Dirham). */
  occupancyTaxes: number | null;
  /** What Airbnb pays D|R|P ("You earn"). */
  payout: number | null;
  currency: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "oct", "october", "sept" - not "decline" or "march-ing". */
const monthOf = (word: string) => {
  const n = MONTHS[word.slice(0, 3)];
  return n && MONTH_NAMES[n - 1].startsWith(word) ? n : undefined;
};

const CURRENCY = /\b(AED|USD|EUR|GBP|SAR)\b|د\.إ|\$|€|£/;
// An amount, optionally signed, with thousands separators and decimals.
const NUMBER = /[-−–]?\s*(?:AED|USD|EUR|GBP|SAR|د\.إ\.?|\$|€|£)?\s*[-−–]?\s*\d{1,3}(?:[,   ]\d{3})*(?:\.\d{1,2})?(?!\d)|[-−–]?\s*(?:AED|USD|EUR|GBP|SAR|د\.إ\.?|\$|€|£)?\s*\d+(?:\.\d{1,2})?/g;

function toNumber(raw: string): number {
  const digits = raw.replace(/[^\d.]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : NaN;
}

// An amount with its currency after it, as Airbnb writes dirhams ("386 د.إ", "1,250د.إ").
const AMOUNT_THEN_CURRENCY = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*(?=AED\b|USD\b|EUR\b|GBP\b|SAR\b|د\.إ)/g;

/** The money amount in a line: the one next to a currency (before it, else after it), else the last one. */
export function amountIn(line: string): number | null {
  const found = [...line.matchAll(NUMBER)].map((m) => m[0]).filter((m) => /\d/.test(m));
  if (found.length === 0) return null;
  const withCurrency = found.filter((m) => CURRENCY.test(m));
  const before = [...line.matchAll(AMOUNT_THEN_CURRENCY)].map((m) => m[0]);
  const pick = (withCurrency.length ? withCurrency : before.length ? before : found).at(-1)!;
  const n = toNumber(pick);
  return Number.isFinite(n) ? n : null;
}

/** A line that is nothing but an amount, e.g. "AED 1,350.00" or "-AED 40.50". */
const isAmountLine = (line: string) =>
  /^[-−–]?\s*(?:AED|USD|EUR|GBP|SAR|د\.إ\.?|\$|€|£)?\s*[-−–]?\s*[\d,.   ]+\s*(?:AED|USD|EUR|GBP|SAR|د\.إ\.?)?$/.test(line) &&
  /\d/.test(line);

/** "Sat, Oct 12, 2026", "Oct 12, 2026", "12 Oct 2026", "Saturday, 12 October" ... */
export function parseDateText(text: string, today: string): string | null {
  const t = text.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;
  let m = t.match(/\b([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?\b(?: (\d{4}))?/);
  if (m && monthOf(m[1])) {
    month = monthOf(m[1]);
    day = Number(m[2]);
    year = m[3] ? Number(m[3]) : undefined;
  } else {
    m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.?(?: (\d{4}))?\b/);
    if (m && monthOf(m[2])) {
      month = monthOf(m[2]);
      day = Number(m[1]);
      year = m[3] ? Number(m[3]) : undefined;
    } else {
      m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (m) [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    }
  }
  if (!month || !day) return null;
  if (!year) {
    // No year on the page: the one that puts the date nearest today.
    const ty = Number(today.slice(0, 4));
    const t0 = Date.parse(today);
    year = [ty - 1, ty, ty + 1].sort(
      (a, b) => Math.abs(Date.UTC(a, month! - 1, day!) - t0) - Math.abs(Date.UTC(b, month! - 1, day!) - t0)
    )[0];
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function parseAirbnbReservationPage(
  text: string,
  url: string | null = null,
  today = new Date().toISOString().slice(0, 10)
): AirbnbReservationPage {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[  ]/g, " ").trim())
    .filter(Boolean);
  const all = lines.join("\n");

  // ---- confirmation code
  const code =
    url?.match(/\b(HM[A-Z0-9]{8})\b/)?.[1] ??
    all.match(/confirmation code\s*[:\n]?\s*([A-Z0-9]{8,12})\b/i)?.[1] ??
    all.match(/\b(HM[A-Z0-9]{8})\b/)?.[1] ??
    null;

  // ---- the value on a label's line, or on the line or two after it
  const after = (label: RegExp, from = 0, to = lines.length, want: "amount" | "text" = "amount") => {
    for (let i = from; i < to; i++) {
      if (!label.test(lines[i])) continue;
      const rest = lines[i].replace(label, " ");
      if (want === "amount") {
        if (CURRENCY.test(rest) || /\d[\d,]*\.\d{2}/.test(rest)) {
          const a = amountIn(rest);
          if (a !== null) return { value: a, negative: /[-−–]\s*(?:AED|USD|EUR|GBP|SAR|د\.إ|\$|€|£)?\s*\d|\(/.test(rest) };
        }
        for (const next of lines.slice(i + 1, i + 3)) {
          if (isAmountLine(next)) return { value: amountIn(next)!, negative: /^[-−–]/.test(next) };
        }
      } else {
        const own = rest.replace(/^[\s:]+/, "").trim();
        if (own) return { value: own, negative: false };
        if (lines[i + 1]) return { value: lines[i + 1], negative: false };
      }
    }
    return null;
  };

  // ---- dates
  const dateAfter = (label: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      if (!label.test(lines[i])) continue;
      for (const candidate of [lines[i].replace(label, " "), lines[i + 1] ?? "", lines[i + 2] ?? ""]) {
        const d = parseDateText(candidate, today);
        if (d) return d;
      }
    }
    return null;
  };
  const checkIn = dateAfter(/^check[- ]?in\b/i);
  let checkOut = dateAfter(/^check[- ]?out\b/i);
  const nightsMatch = all.match(/\b(\d{1,3})\s+nights?\b/i);
  let nights = nightsMatch ? Number(nightsMatch[1]) : null;
  if (checkIn && checkOut) {
    if (checkOut <= checkIn) checkOut = null;
    else nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
  }
  if (checkIn && !checkOut && nights) {
    checkOut = new Date(Date.parse(checkIn) + nights * 86_400_000).toISOString().slice(0, 10);
  }
  if (!checkIn) checkOut = null;

  // ---- guests
  const count = (re: RegExp) => {
    const m = all.match(re);
    return m ? Number(m[1]) : null;
  };
  let adults = count(/\b(\d{1,2})\s+adults?\b/i);
  const children = count(/\b(\d{1,2})\s+child(?:ren)?\b/i);
  const infants = count(/\b(\d{1,2})\s+infants?\b/i);
  if (adults === null) adults = count(/\b(\d{1,2})\s+guests?\b/i);

  // ---- guest name
  let guestName: string | null = null;
  const named = after(/^guest name\s*:?|^guest\s*:|^guest$/i, 0, lines.length, "text");
  if (named && typeof named.value === "string" && named.value.length <= 60) guestName = named.value;
  if (!guestName) {
    for (const l of lines) {
      const m = l.match(/^(?:[Mm]essage|[Cc]all|[Cc]ontact|[Aa]bout|[Tt]ext)\s+(\p{Lu}[\p{L}'’.-]*(?:\s\p{Lu}[\p{L}'’.-]*){0,3})$/u);
      if (m && !/^(host|guest|airbnb|support)$/i.test(m[1])) {
        guestName = m[1];
        break;
      }
    }
  }

  // ---- money: the host's side when the page shows it
  const hostStart = lines.findIndex((l) => /^(host payout|your payout|payout|you earn|host earnings|your earnings)\b/i.test(l));
  const guestStart = lines.findIndex((l) => /^(guest paid|guest payment|guest's payment)\b/i.test(l));
  const host = hostStart >= 0 ? ([hostStart, lines.length] as const) : ([0, lines.length] as const);
  const guestRange =
    guestStart >= 0 ? ([guestStart, hostStart > guestStart ? hostStart : lines.length] as const) : ([0, lines.length] as const);

  const roomFeeHit = after(/\broom fee\b|\baccommodation\b/i, ...host);
  let roomFee = (roomFeeHit?.value as number | undefined) ?? null;
  if (roomFee === null) {
    // "AED 450.00 x 3 nights"
    const m = all.match(/((?:AED|د\.إ\.?|\$|€|£)?\s*[\d,]+(?:\.\d{1,2})?\s*(?:AED)?)\s*[x×]\s*(\d{1,3})\s+nights?/i);
    if (m) roomFee = Math.round(amountIn(m[1])! * Number(m[2]) * 100) / 100;
  }
  const cleaningFee = (after(/\bcleaning fee\b/i, ...host)?.value as number | undefined) ?? null;
  const hostFeeHit = after(/\bhost service fee\b|\bhost fee\b/i, ...host) ?? (hostStart >= 0 ? after(/\bservice fee\b/i, ...host) : null);
  const hostServiceFee = hostFeeHit ? Math.abs(hostFeeHit.value as number) : null;
  const taxes = (after(/\boccupancy tax(es)?\b|\btourism\b|\btourist tax\b/i, ...guestRange)?.value as number | undefined) ??
    (after(/\boccupancy tax(es)?\b|\btourism\b|\btourist tax\b/i)?.value as number | undefined) ?? null;
  let payout =
    (after(/^(you earn|total payout|your payout|payout total|total \(?[a-z]{3}\)?|total)\b/i, ...host)?.value as number | undefined) ?? null;
  if (hostStart < 0 && payout !== null && guestStart >= 0) payout = null; // that total was the guest's
  if (payout === null && roomFee !== null && hostServiceFee !== null) {
    payout = Math.round((roomFee + (cleaningFee ?? 0) - hostServiceFee) * 100) / 100;
  }

  const currency = all.match(/\b(AED|USD|EUR|GBP|SAR)\b/)?.[1] ?? (/د\.إ/.test(all) ? "AED" : null);

  return {
    code,
    guestName,
    checkIn,
    checkOut,
    nights,
    adults,
    children,
    infants,
    roomFee,
    cleaningFee,
    hostServiceFee,
    occupancyTaxes: taxes,
    payout,
    currency,
  };
}
