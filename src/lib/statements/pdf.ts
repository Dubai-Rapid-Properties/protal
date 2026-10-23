/**
 * The owner statement as a PDF, attached to the email the owner receives
 * when it is approved (0060). It follows the printed statement: page 1 the
 * summary, page 2 the booking breakdown, then the expenses. Drawn with
 * pdf-lib, which runs in the Cloudflare worker; other fees (0056) never
 * appear here.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { formatAED } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { LOGO_BLACK_PNG_BASE64 } from "./logo-png";
import { bookingFee, statementSummary } from "./summary";
import type { EmailLine, EmailStatement } from "./email";

export interface PdfCompany {
  legal_name?: string | null;
  registered_address?: string | null;
  trade_licence_number?: string | null;
  rera_broker_number?: string | null;
  trn?: string | null;
  phone?: string | null;
  email?: string | null;
  vat_rate?: number | null;
}

export interface PdfOwner {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  address_line?: string | null;
  trn?: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const M = 48; // margin
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const GOLD = rgb(0.776, 0.631, 0.357);
const RULE = rgb(0.85, 0.86, 0.88);
const PANEL = rgb(0.97, 0.97, 0.98);

/** The standard PDF fonts only know Western characters; anything else becomes "?". */
const clean = (s: string) =>
  s.replace(/[‐-―]/g, "–").replace(/[^\x20-\x7E -ÿ–—‘’“”•·€]/g, "?");

export async function buildStatementPdf(input: {
  statement: EmailStatement & { issued_on?: string | null };
  lines: EmailLine[];
  owner: PdfOwner;
  company?: PdfCompany | null;
}): Promise<Uint8Array> {
  const { statement, lines, owner, company } = input;
  const s = statementSummary(statement, lines);
  const doc = await PDFDocument.create();
  doc.setTitle(`Owner statement ${statement.statement_number}`);
  doc.setAuthor(company?.legal_name ?? "D|R|P Dubai Rapid Properties");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(Buffer.from(LOGO_BLACK_PNG_BASE64, "base64"));

  const [W, H] = A4;
  let page: PDFPage = doc.addPage(A4);
  let y = H - M;

  const draw = (
    text: string,
    x: number,
    at: number,
    o: { size?: number; f?: PDFFont; color?: RGB; right?: boolean; max?: number } = {}
  ) => {
    const size = o.size ?? 9.5;
    const f = o.f ?? font;
    let t = clean(text);
    if (o.max) while (t.length > 1 && f.widthOfTextAtSize(t, size) > o.max) t = t.slice(0, -2) + "…";
    const w = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: o.right ? x - w : x, y: at, size, font: f, color: o.color ?? INK });
  };
  const rule = (at: number, color = RULE, thickness = 0.6) =>
    page.drawLine({ start: { x: M, y: at }, end: { x: W - M, y: at }, thickness, color });
  const money = (n: number) => formatAED(n);
  const less = (n: number) => `(${formatAED(n)})`;
  const vat = company?.vat_rate ? `${Math.round(company.vat_rate * 100)}%` : "5%";
  const period = `${formatDate(statement.period_start)} – ${formatDate(statement.period_end)}`;

  // Letterhead
  const logoW = 110;
  page.drawImage(logo, { x: M, y: y - logoW * (506 / 953), width: logoW, height: logoW * (506 / 953) });
  draw("Owner Statement", W - M, y - 12, { size: 15, f: bold, right: true });
  draw(statement.statement_number, W - M, y - 28, { right: true });
  draw(`Period ${period}`, W - M, y - 42, { size: 8.5, color: MUTED, right: true });
  if (statement.issued_on) draw(`Issued ${formatDate(statement.issued_on)}`, W - M, y - 54, { size: 8.5, color: MUTED, right: true });
  y -= logoW * (506 / 953) + 16;
  draw(company?.legal_name ?? "DRP Holiday Homes LLC", M, y, { size: 10, f: bold });
  const companyLines = [
    company?.registered_address,
    [company?.trade_licence_number && `Trade Licence ${company.trade_licence_number}`, company?.rera_broker_number && `RERA ${company.rera_broker_number}`]
      .filter(Boolean)
      .join(" · "),
    company?.trn && `TRN ${company.trn}`,
    [company?.phone, company?.email].filter(Boolean).join(" · "),
  ].filter(Boolean) as string[];
  for (const l of companyLines) {
    y -= 12;
    draw(l, M, y, { size: 8.5, color: MUTED });
  }
  y -= 14;
  rule(y, GOLD, 1.5);

  // Owner
  y -= 24;
  draw("STATEMENT FOR", M, y, { size: 7.5, f: bold, color: MUTED });
  y -= 15;
  draw(owner.full_name, M, y, { size: 11, f: bold });
  for (const l of [owner.address_line, [owner.email, owner.phone].filter(Boolean).join(" · "), owner.trn && `TRN ${owner.trn}`]) {
    if (!l) continue;
    y -= 12;
    draw(l, M, y, { size: 9, color: MUTED });
  }

  // Figures
  y -= 30;
  const stats: [string, string][] = [
    ["BOOKINGS", String(statement.bookings_count)],
    ["NIGHTS RENTED", String(statement.rented_nights)],
    ["OCCUPANCY", statement.occupancy_pct == null ? "—" : `${Number(statement.occupancy_pct).toFixed(1)}%`],
    ["GROSS BOOKING INCOME", money(s.grossIncome)],
  ];
  const gap = 8;
  const boxW = (W - 2 * M - 3 * gap) / 4;
  stats.forEach(([label, value], i) => {
    const x = M + i * (boxW + gap);
    page.drawRectangle({ x, y: y - 30, width: boxW, height: 44, borderColor: RULE, borderWidth: 0.8 });
    draw(label, x + 8, y, { size: 6.5, color: MUTED, max: boxW - 14 });
    draw(value, x + 8, y - 20, { size: 12, f: bold, max: boxW - 14 });
  });
  y -= 52;

  // Summary
  const feeNote = [
    statement.management_fee_pct != null ? `${Number(statement.management_fee_pct)}%` : null,
    Number(statement.vat_total_aed) > 0 ? `VAT ${vat}` : null,
  ]
    .filter(Boolean)
    .join(" + ");
  const rows: [string, string, boolean?][] = [
    ["Total gross booking income", money(s.grossIncome)],
    ["Less: total expenses", less(s.totalExpenses)],
    ["Utilities", money(s.utilities), true],
    ["Maintenance", money(s.maintenance), true],
    ...(Math.abs(s.otherExpenses) >= 0.005 ? [["Other expenses", money(s.otherExpenses), true] as [string, string, boolean]] : []),
    [`Less: total management fee${feeNote ? ` (${feeNote})` : ""}`, less(s.totalFee)],
    ...(Number(statement.vat_total_aed) > 0
      ? [[`Fee ${money(Number(statement.management_fee_aed))} + VAT ${money(Number(statement.vat_total_aed))}`, "", true] as [string, string, boolean]]
      : []),
    ...(s.deducted > 0 ? [["Less: other charges", less(s.deducted)] as [string, string]] : []),
  ];
  const panelH = rows.reduce((h, r) => h + (r[2] ? 14 : 18), 0) + 44;
  page.drawRectangle({ x: M, y: y - panelH + 8, width: W - 2 * M, height: panelH, color: PANEL });
  y -= 10;
  for (const [label, value, sub] of rows) {
    draw(label, M + (sub ? 24 : 12), y, { size: sub ? 8 : 9.5, color: sub ? MUTED : INK });
    if (value) draw(value, W - M - 12, y, { size: sub ? 8 : 9.5, color: sub ? MUTED : INK, right: true });
    y -= sub ? 14 : 18;
  }
  page.drawLine({ start: { x: M + 12, y: y + 8 }, end: { x: W - M - 12, y: y + 8 }, thickness: 1.5, color: INK });
  y -= 8;
  draw("Net income payable to owner", M + 12, y, { size: 11.5, f: bold });
  draw(money(Number(statement.net_payout_aed)), W - M - 12, y, { size: 11.5, f: bold, right: true });

  // Page 2: booking breakdown
  const newPage = () => {
    page = doc.addPage(A4);
    y = H - M;
    draw(`${statement.statement_number} · ${period}`, W - M, y + 14, { size: 7.5, color: MUTED, right: true });
  };
  const need = (h: number) => {
    if (y - h < M + 30) newPage();
  };
  newPage();
  draw("BOOKING BREAKDOWN", M, y, { size: 9, f: bold, color: MUTED });
  y -= 20;
  // Columns: guest, check-in, check-out, nights, rent, fee, owner net (right edges for numbers)
  const col = { guest: M, inn: M + 150, out: M + 212, nights: M + 300, rent: M + 362, fee: M + 432, net: W - M };
  const header = () => {
    draw("GUEST", col.guest, y, { size: 7, f: bold, color: MUTED });
    draw("CHECK-IN", col.inn, y, { size: 7, f: bold, color: MUTED });
    draw("CHECK-OUT", col.out, y, { size: 7, f: bold, color: MUTED });
    draw("NIGHTS", col.nights, y, { size: 7, f: bold, color: MUTED, right: true });
    draw("RENT", col.rent, y, { size: 7, f: bold, color: MUTED, right: true });
    draw("MGMT FEE", col.fee, y, { size: 7, f: bold, color: MUTED, right: true });
    draw("OWNER NET", col.net, y, { size: 7, f: bold, color: MUTED, right: true });
    y -= 6;
    rule(y);
    y -= 14;
  };
  if (s.income.length === 0 && s.feeLines.length === 0) {
    draw("No bookings in this period.", M, y, { color: MUTED });
    y -= 20;
  } else {
    header();
    for (const l of s.income) {
      need(28);
      const fee = bookingFee(l);
      const stay = l.check_in && l.check_out ? Math.round((Date.parse(l.check_out) - Date.parse(l.check_in)) / 86_400_000) : null;
      draw(l.guest_name || l.description, col.guest, y, { size: 8.5, max: 142 });
      draw(l.check_in ? formatDate(l.check_in) : "—", col.inn, y, { size: 8.5 });
      draw(l.check_out ? formatDate(l.check_out) : formatDate(l.entry_date), col.out, y, { size: 8.5 });
      draw(l.nights == null ? "—" : String(l.nights), col.nights, y, { size: 8.5, right: true });
      draw(money(Number(l.amount_aed)), col.rent, y, { size: 8.5, right: true });
      draw(fee == null ? "—" : less(fee), col.fee, y, { size: 8.5, right: true });
      draw(money(Number(l.amount_aed) - (fee ?? 0)), col.net, y, { size: 8.5, right: true });
      if (l.unit_label || (stay != null && l.nights != null && stay !== l.nights)) {
        y -= 10;
        const note = [l.unit_label, stay != null && l.nights != null && stay !== l.nights ? `${l.nights} of ${stay} nights in this period` : null]
          .filter(Boolean)
          .join(" · ");
        draw(note, col.guest, y, { size: 7, color: MUTED, max: 290 });
      }
      y -= 8;
      rule(y);
      y -= 13;
    }
    for (const f of s.feeLines) {
      need(22);
      draw(f.description, col.guest, y, { size: 8.5, max: 300 });
      draw(less(Number(f.total_aed)), col.fee, y, { size: 8.5, right: true });
      draw(money(-Number(f.total_aed)), col.net, y, { size: 8.5, right: true });
      y -= 8;
      rule(y);
      y -= 13;
    }
    need(22);
    page.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 1.5, color: INK });
    y -= 4;
    draw("Total", col.guest, y, { size: 9, f: bold });
    draw(String(statement.rented_nights), col.nights, y, { size: 9, f: bold, right: true });
    draw(money(s.grossIncome), col.rent, y, { size: 9, f: bold, right: true });
    draw(less(s.totalFee), col.fee, y, { size: 9, f: bold, right: true });
    draw(money(s.grossIncome - s.totalFee), col.net, y, { size: 9, f: bold, right: true });
    y -= 14;
    if (Number(statement.vat_total_aed) > 0) draw(`Management fee shown including VAT at ${vat}.`, M, y, { size: 7.5, color: MUTED });
    y -= 26;
  }

  // Expenses
  need(60);
  draw("EXPENSES", M, y, { size: 9, f: bold, color: MUTED });
  y -= 20;
  if (s.expenses.length === 0) {
    draw("No expenses in this period.", M, y, { color: MUTED });
    y -= 20;
  } else {
    const ex = { date: M, unit: M + 72, desc: M + 170, net: M + 362, vat: M + 432, total: W - M };
    draw("DATE", ex.date, y, { size: 7, f: bold, color: MUTED });
    draw("UNIT", ex.unit, y, { size: 7, f: bold, color: MUTED });
    draw("DESCRIPTION", ex.desc, y, { size: 7, f: bold, color: MUTED });
    draw("NET", ex.net, y, { size: 7, f: bold, color: MUTED, right: true });
    draw("VAT", ex.vat, y, { size: 7, f: bold, color: MUTED, right: true });
    draw("TOTAL", ex.total, y, { size: 7, f: bold, color: MUTED, right: true });
    y -= 6;
    rule(y);
    y -= 14;
    for (const e of s.expenses) {
      need(22);
      draw(formatDate(e.entry_date), ex.date, y, { size: 8.5 });
      draw(e.unit_label ?? "", ex.unit, y, { size: 8.5, max: 92 });
      draw(e.description, ex.desc, y, { size: 8.5, max: 132 });
      draw(money(Number(e.amount_aed)), ex.net, y, { size: 8.5, right: true });
      draw(Number(e.total_aed) === Number(e.amount_aed) ? "—" : money(Number(e.total_aed) - Number(e.amount_aed)), ex.vat, y, { size: 8.5, right: true });
      draw(money(Number(e.total_aed)), ex.total, y, { size: 8.5, right: true });
      y -= 8;
      rule(y);
      y -= 13;
    }
  }

  // Footer
  need(50);
  y -= 10;
  rule(y);
  y -= 14;
  draw(`All amounts are in UAE Dirhams (AED). VAT is applied at ${vat} on taxable supplies only.`, M, y, { size: 7.5, color: MUTED });
  y -= 11;
  draw("Queries on this statement should be raised with your property manager within 14 days of issue.", M, y, { size: 7.5, color: MUTED });

  return doc.save();
}
