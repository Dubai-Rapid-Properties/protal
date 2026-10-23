/**
 * The approved owner statement as the owner receives it by email (0060): the
 * summary and every booking, in the body itself, so it reads on a phone
 * without an attachment. Plain text for the text part, branded HTML for the
 * rest. Other fees (0056) are for our own figures and never appear here.
 */
import { formatAED } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { GOLD, INK, MUTED, NAVY, escape, signature, type InviteCompany } from "@/lib/notify/invite-email";
import { bookingFee, statementSummary, type SummaryLine, type SummaryStatement } from "./summary";

export interface EmailStatement extends SummaryStatement {
  statement_number: string;
  period_start: string;
  period_end: string;
  bookings_count: number;
  rented_nights: number;
  occupancy_pct: number | null;
  management_fee_pct: number | null;
}

export interface EmailLine extends SummaryLine {
  description: string;
  entry_date: string;
  unit_label: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
}

export interface StatementEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildStatementEmail(input: {
  statement: EmailStatement;
  lines: EmailLine[];
  ownerName: string;
  company?: (InviteCompany & { vat_rate?: number | null }) | null;
  /** Where the logo is served from: the owner portal's address. */
  portalUrl: string;
}): StatementEmail {
  const { statement, lines, ownerName, company, portalUrl } = input;
  const s = statementSummary(statement, lines);
  const period = `${formatDate(statement.period_start)} – ${formatDate(statement.period_end)}`;
  const subject = `Your owner statement ${statement.statement_number}, ${period}`;
  const vat = company?.vat_rate ? `${Math.round(company.vat_rate * 100)}%` : "5%";
  const feeNote = [
    statement.management_fee_pct != null ? `${Number(statement.management_fee_pct)}%` : null,
    Number(statement.vat_total_aed) > 0 ? `VAT ${vat}` : null,
  ]
    .filter(Boolean)
    .join(" + ");
  const occupancy = statement.occupancy_pct == null ? "—" : `${Number(statement.occupancy_pct).toFixed(1)}%`;
  const money = (n: number) => formatAED(n);
  const less = (n: number) => `(${formatAED(n)})`;

  const summary: [string, string, boolean?][] = [
    ["Total gross booking income", money(s.grossIncome)],
    ["Less: total expenses", less(s.totalExpenses)],
    ["   Utilities", money(s.utilities), true],
    ["   Maintenance", money(s.maintenance), true],
    ...(Math.abs(s.otherExpenses) >= 0.005 ? [["   Other expenses", money(s.otherExpenses), true] as [string, string, boolean]] : []),
    [`Less: total management fee${feeNote ? ` (${feeNote})` : ""}`, less(s.totalFee)],
    ...(s.deducted > 0 ? [["Less: other charges", less(s.deducted)] as [string, string]] : []),
  ];
  const net = money(Number(statement.net_payout_aed));

  const bookings = s.income.map((l) => {
    const fee = bookingFee(l);
    return {
      guest: l.guest_name || l.description,
      unit: l.unit_label ?? "",
      dates: l.check_in && l.check_out ? `${formatDate(l.check_in)} – ${formatDate(l.check_out)}` : formatDate(l.entry_date),
      nights: l.nights == null ? "" : String(l.nights),
      rent: money(Number(l.amount_aed)),
      fee: fee == null ? "—" : less(fee),
      net: money(Number(l.amount_aed) - (fee ?? 0)),
    };
  });
  const feeRows = s.feeLines.map((l) => ({ label: l.description, fee: less(Number(l.total_aed)) }));

  const text = [
    `Dear ${ownerName},`,
    "",
    `Please find your owner statement ${statement.statement_number} for ${period} below.`,
    "",
    `Bookings: ${statement.bookings_count}   Nights rented: ${statement.rented_nights}   Occupancy: ${occupancy}`,
    "",
    ...summary.map(([label, value]) => `${label}: ${value}`),
    `Net income payable to you: ${net}`,
    "",
    "Booking breakdown",
    ...(bookings.length
      ? bookings.map((b) => `- ${b.guest}, ${b.dates}${b.nights ? `, ${b.nights} nights` : ""}: rent ${b.rent}, fee ${b.fee}, net ${b.net}`)
      : ["No bookings in this period."]),
    ...feeRows.map((f) => `- ${f.label}: ${f.fee}`),
    "",
    ...(s.expenses.length ? ["Expenses", ...s.expenses.map((e) => `- ${formatDate(e.entry_date)} ${e.description}: ${money(Number(e.total_aed))}`), ""] : []),
    "All amounts are in UAE Dirhams (AED). Queries on this statement should be raised with your property manager within 14 days.",
    "",
    "Kind regards,",
    ...signature(company),
  ].join("\n");

  const td = "padding:6px 0;font-size:14px;line-height:1.4;";
  const th = `padding:6px 4px 6px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};text-align:left;border-bottom:1px solid #e5e7eb;`;
  const cell = `padding:8px 4px 8px 0;font-size:13px;line-height:1.4;color:${INK};border-bottom:1px solid #f3f4f6;vertical-align:top;`;
  const stat = (label: string, value: string) =>
    `<td width="33%" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};">${label}</div><div style="margin-top:4px;font-size:18px;font-weight:600;color:${INK};">${value}</div></td>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;">Net income payable to you: ${escape(net)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <tr><td align="center" style="background:${NAVY};padding:28px 24px;">
    <img src="${escape(portalUrl)}/logo-white.png" width="160" alt="D|R|P Dubai Rapid Properties" style="display:block;width:160px;max-width:60%;height:auto;border:0;">
  </td></tr>
  <tr><td style="padding:32px 32px 8px;color:${INK};">
    <p style="margin:0 0 6px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};font-weight:600;">Owner statement ${escape(statement.statement_number)}</p>
    <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:600;">${escape(period)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Dear ${escape(ownerName)}, here is your statement for the period.</p>
  </td></tr>
  <tr><td style="padding:0 32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate;"><tr>
      ${stat("Bookings", String(statement.bookings_count))}${stat("Nights rented", String(statement.rented_nights))}${stat("Occupancy", occupancy)}
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:8px 16px;">
      ${summary
        .map(
          ([label, value, sub]) =>
            `<tr><td style="${td}${sub ? `padding-left:14px;font-size:12px;color:${MUTED};` : `color:${INK};`}">${escape(label.trim())}</td><td align="right" style="${td}${sub ? `font-size:12px;color:${MUTED};` : `color:${INK};`}white-space:nowrap;">${escape(value)}</td></tr>`
        )
        .join("\n      ")}
      <tr><td style="padding:10px 0 4px;font-size:16px;font-weight:700;color:${INK};border-top:2px solid ${NAVY};">Net income payable to you</td><td align="right" style="padding:10px 0 4px;font-size:16px;font-weight:700;color:${INK};border-top:2px solid ${NAVY};white-space:nowrap;">${escape(net)}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 8px;">
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};font-weight:600;">Booking breakdown</p>
    ${
      bookings.length || feeRows.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><th style="${th}">Rent</th><th style="${th}text-align:right;">Mgmt fee</th><th style="${th}text-align:right;padding-right:0;">Owner net</th></tr>
      ${bookings
        .map(
          (b) =>
            `<tr><td colspan="3" style="padding:10px 0 2px;font-size:14px;line-height:1.4;color:${INK};"><strong>${escape(b.guest)}</strong><br><span style="font-size:12px;color:${MUTED};">${escape(b.dates)}${b.nights ? ` · ${escape(b.nights)} nights` : ""}</span></td></tr>
      <tr><td style="${cell}white-space:nowrap;">${escape(b.rent)}</td><td align="right" style="${cell}white-space:nowrap;">${escape(b.fee)}</td><td align="right" style="${cell}white-space:nowrap;padding-right:0;">${escape(b.net)}</td></tr>`
        )
        .join("\n      ")}
      ${feeRows
        .map(
          (f) =>
            `<tr><td colspan="2" style="${cell}">${escape(f.label)}</td><td align="right" style="${cell}white-space:nowrap;padding-right:0;">${escape(f.fee)}</td></tr>`
        )
        .join("\n      ")}
      <tr><td colspan="3" style="padding:12px 0 2px;font-size:14px;font-weight:700;color:${INK};border-top:2px solid ${NAVY};">Total</td></tr>
      <tr><td style="${cell}font-weight:700;white-space:nowrap;">${escape(money(s.grossIncome))}</td><td align="right" style="${cell}font-weight:700;white-space:nowrap;">${escape(less(s.totalFee))}</td><td align="right" style="${cell}font-weight:700;white-space:nowrap;padding-right:0;">${escape(money(s.grossIncome - s.totalFee))}</td></tr>
    </table>`
        : `<p style="margin:0;font-size:14px;color:${MUTED};">No bookings in this period.</p>`
    }
  </td></tr>
  ${
    s.expenses.length
      ? `<tr><td style="padding:16px 32px 8px;">
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};font-weight:600;">Expenses</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${s.expenses
        .map(
          (e) =>
            `<tr><td style="${cell}white-space:nowrap;">${escape(formatDate(e.entry_date))}</td><td style="${cell}">${escape(e.description)}</td><td align="right" style="${cell}white-space:nowrap;padding-right:0;">${escape(money(Number(e.total_aed)))}</td></tr>`
        )
        .join("\n      ")}
    </table>
  </td></tr>`
      : ""
  }
  <tr><td style="padding:20px 32px 28px;font-size:12px;line-height:1.6;color:${MUTED};">
    All amounts are in UAE Dirhams (AED). Management fees include VAT at ${vat} where it applies.<br>
    Queries on this statement should be raised with your property manager within 14 days.
  </td></tr>
  <tr><td align="center" style="background:${NAVY};padding:24px;font-size:12px;line-height:1.7;color:#d1d5db;">
    ${signature(company).map(escape).join("<br>")}
  </td></tr>
</table>
<p style="margin:16px 0 0;font-size:11px;color:${MUTED};font-family:Helvetica,Arial,sans-serif;">You received this email because D|R|P manages a property for you.</p>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
