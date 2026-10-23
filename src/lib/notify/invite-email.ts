/**
 * The message that gives an owner their portal login: plain text for
 * WhatsApp and the office's own mail app, and a branded HTML version for
 * when the portal sends the email itself.
 */
import { validityLabel } from "@/lib/auth/link-validity";

export interface InviteCompany {
  trade_name?: string | null;
  legal_name?: string | null;
  registered_address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface InviteInput {
  ownerName: string;
  email: string;
  /** One-time link to set the password. */
  link: string;
  /** The owner portal's address, for signing in afterwards. */
  portalUrl: string;
  company?: InviteCompany | null;
  /** How long the link works: Supabase -> Auth -> Email OTP expiry. Default 1. */
  linkValidHours?: number;
  /**
   * "password": the link leads to choosing a password (env.ownerPasswords on).
   * "link": the link opens the portal directly; no password yet.
   */
  mode?: "password" | "link";
}

export interface InviteMessage {
  subject: string;
  text: string;
  html: string;
}

const NAVY = "#171f30";
const GOLD = "#c19f61";
const INK = "#1f2937";
const MUTED = "#6b7280";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Name, legal name and contact. No street address: owners asked for it off. */
function signature(company: InviteCompany | null | undefined): string[] {
  const contact = [company?.phone, company?.email].filter(Boolean).join(" · ");
  return ["D|R|P - Dubai Rapid Properties", company?.legal_name ?? "", contact].filter(Boolean);
}

export function buildPortalInvite(input: InviteInput): InviteMessage {
  const { ownerName, email, link, portalUrl, company, linkValidHours = 1, mode = "password" } = input;
  const direct = mode === "link";
  const validity = validityLabel(linkValidHours);
  const portalHost = portalUrl.replace(/^https?:\/\//, "");
  const subject = "Your D|R|P owner portal is ready";

  const text = [
    `Dear ${ownerName},`,
    "",
    "Welcome to the D|R|P owner portal. You can now see your properties, the booking calendar and upcoming stays online, at any time.",
    "",
    ...(direct
      ? [
          "Open your owner portal here:",
          link,
          "",
          `This link works for ${validity}. Whenever you need to open the portal after that, just ask us for a new link.`,
          "",
        ]
      : [
          "To get started, set your password here:",
          link,
          "",
          `This link works for ${validity}. If it has expired, just ask us for a new one.`,
          "",
          "After that, sign in any time at:",
          portalUrl,
          `Email: ${email}`,
          "",
        ]),
    "Kind regards,",
    ...signature(company),
  ].join("\n");

  const features = [
    ["Booking calendar", "See which nights are booked, blocked or free."],
    ["Upcoming stays", "New, changed and cancelled bookings as they happen."],
    ["Your properties", "Permits, maintenance and documents in one place."],
  ];

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;">${direct ? "Open your portal" : "Set your password"} to see your properties and bookings online.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <tr><td align="center" style="background:${NAVY};padding:32px 24px;">
    <img src="${escape(portalUrl)}/logo-white.png" width="180" alt="D|R|P Dubai Rapid Properties" style="display:block;width:180px;max-width:60%;height:auto;border:0;">
  </td></tr>
  <tr><td style="padding:36px 36px 8px;color:${INK};">
    <p style="margin:0 0 6px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};font-weight:600;">Owner portal</p>
    <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;font-weight:600;color:${INK};">Welcome, ${escape(ownerName)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">Your D|R|P owner portal is ready. You can now follow your properties and their bookings online, at any time.</p>
  </td></tr>
  <tr><td align="center" style="padding:0 36px 12px;">
    <a href="${escape(link)}" style="display:inline-block;background:${GOLD};color:${NAVY};text-decoration:none;font-size:16px;font-weight:600;padding:14px 32px;border-radius:8px;">${direct ? "Open my portal" : "Set my password"}</a>
  </td></tr>
  <tr><td align="center" style="padding:0 36px 28px;">
    <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">This link works for ${validity}.<br>${direct ? "Ask us for a new link whenever you need one." : "If it has expired, just ask us for a new one."}</p>
  </td></tr>
  <tr><td style="padding:0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;">
      ${features
        .map(
          ([title, body]) => `<tr><td style="padding:14px 0 0;font-size:14px;line-height:1.5;color:${INK};">
        <span style="color:${GOLD};font-weight:700;">&#10003;</span>&nbsp; <strong>${title}</strong><br>
        <span style="color:${MUTED};padding-left:20px;display:inline-block;">${body}</span>
      </td></tr>`
        )
        .join("\n      ")}
    </table>
  </td></tr>
  ${direct ? `<tr><td style="padding:0 0 32px;"></td></tr>` : `<tr><td style="padding:28px 36px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;">
      <tr><td style="padding:16px 20px;font-size:14px;line-height:1.6;color:${INK};">
        <strong>Signing in later</strong><br>
        <a href="${escape(portalUrl)}" style="color:${NAVY};">${escape(portalHost)}</a><br>
        <span style="color:${MUTED};">Email:</span> ${escape(email)}
      </td></tr>
    </table>
  </td></tr>`}
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
