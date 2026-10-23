/**
 * The email that carries an approved owner statement to the owner (0060): a
 * short note saying which period it covers, with the statement attached as a
 * PDF (./pdf.ts). Plain text, and a branded HTML version of the same note.
 */
import { formatDate } from "@/lib/dates";
import { GOLD, INK, MUTED, NAVY, escape, signature, type InviteCompany } from "@/lib/notify/invite-email";
import type { SummaryLine, SummaryStatement } from "./summary";

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
  /** What to call the attached PDF. */
  filename: string;
}

export function buildStatementEmail(input: {
  statement: Pick<EmailStatement, "statement_number" | "period_start" | "period_end">;
  ownerName: string;
  company?: InviteCompany | null;
  /** Where the logo is served from: the owner portal's address. */
  portalUrl: string;
}): StatementEmail {
  const { statement, ownerName, company, portalUrl } = input;
  const period = `${formatDate(statement.period_start)} – ${formatDate(statement.period_end)}`;
  const subject = `Owner statement ${statement.statement_number}, ${period}`;
  const filename = statementFilename(statement.statement_number);

  const text = [
    `Dear ${ownerName},`,
    "",
    `Please find attached your owner statement for the period ${period} (${statement.statement_number}).`,
    "",
    "If you have any questions about it, just reply to this email.",
    "",
    "Kind regards,",
    ...signature(company),
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <tr><td align="center" style="background:${NAVY};padding:28px 24px;">
    <img src="${escape(portalUrl)}/logo-white.png" width="160" alt="D|R|P Dubai Rapid Properties" style="display:block;width:160px;max-width:60%;height:auto;border:0;">
  </td></tr>
  <tr><td style="padding:32px 32px 28px;color:${INK};">
    <p style="margin:0 0 6px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};font-weight:600;">Owner statement</p>
    <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:600;">${escape(period)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Dear ${escape(ownerName)},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Please find attached your owner statement for the period <strong>${escape(period)}</strong> (${escape(statement.statement_number)}).</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">If you have any questions about it, just reply to this email.</p>
    <p style="margin:0;font-size:13px;color:${MUTED};">Attached: ${escape(filename)}</p>
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

  return { subject, text, html, filename };
}

/** The PDF's name: Owner-statement-DRP-STM-2026-0010.pdf */
export const statementFilename = (statementNumber: string) =>
  `Owner-statement-${statementNumber.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
