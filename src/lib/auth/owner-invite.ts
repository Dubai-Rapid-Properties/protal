import { createHash, randomBytes } from "node:crypto";

/**
 * Owner sign-in links the portal issues itself (migration 0050). The link
 * carries a random token; only its SHA-256 is stored, so a database read
 * cannot be turned into a working link.
 */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A token as the link carries it: 43 base64url characters. */
export const isInviteToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);

export type InviteCheck = "ok" | "expired" | "used";

/**
 * Whether an invite still signs its owner in: before it expires, and - with
 * owner passwords on - until the owner has chosen a password after it was
 * made (setPassword stamps last_login_at). Before that it works as often as
 * it is opened.
 */
export function checkInvite(
  invite: { created_at: string; expires_at: string },
  lastLoginAt: string | null,
  passwords: boolean,
  now = new Date()
): InviteCheck {
  if (new Date(invite.expires_at) <= now) return "expired";
  if (passwords && lastLoginAt && new Date(lastLoginAt) > new Date(invite.created_at)) return "used";
  return "ok";
}
