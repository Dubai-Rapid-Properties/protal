import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInvite, hashInviteToken, isInviteToken, newInviteToken } from "@/lib/auth/owner-invite";
import { validityLabel } from "@/lib/auth/link-validity";

test("a new token is random, link-safe, and only its hash is kept", () => {
  const a = newInviteToken();
  const b = newInviteToken();
  assert.notEqual(a.token, b.token);
  assert.ok(isInviteToken(a.token));
  assert.equal(a.hash, hashInviteToken(a.token));
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(isInviteToken("short"), false);
  assert.equal(isInviteToken(`${a.token.slice(0, 42)}/`), false);
});

test("the link works as often as opened until it expires or a password is chosen", () => {
  const invite = { created_at: "2026-10-23T08:00:00Z", expires_at: "2026-10-30T08:00:00Z" };
  const at = (iso: string) => new Date(iso);
  assert.equal(checkInvite(invite, null, true, at("2026-10-23T12:00:00Z")), "ok");
  assert.equal(checkInvite(invite, null, true, at("2026-10-29T12:00:00Z")), "ok", "days later, opened again");
  assert.equal(checkInvite(invite, "2026-10-01T00:00:00Z", true, at("2026-10-24T00:00:00Z")), "ok", "a password from before: a reset");
  assert.equal(checkInvite(invite, "2026-10-23T09:00:00Z", true, at("2026-10-24T00:00:00Z")), "used");
  assert.equal(checkInvite(invite, "2026-10-23T09:00:00Z", false, at("2026-10-24T00:00:00Z")), "ok", "no passwords: the link is the way in");
  assert.equal(checkInvite(invite, null, true, at("2026-10-30T08:00:00Z")), "expired");
});

test("validity reads in days when whole", () => {
  assert.equal(validityLabel(168), "7 days");
  assert.equal(validityLabel(24), "1 day");
  assert.equal(validityLabel(36), "36 hours");
  assert.equal(validityLabel(1), "1 hour");
});
