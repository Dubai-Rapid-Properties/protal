"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { checkInvite, hashInviteToken, isInviteToken } from "@/lib/auth/owner-invite";
import { getProfile } from "@/lib/auth/session";
import { portalHome, roleAllowedOnPortal } from "@/lib/portal";
import { currentPortal, WRONG_PORTAL_PATH } from "@/lib/portal-server";
import { env } from "@/lib/env";

const LINK_TYPES = new Set(["invite", "recovery"]);

/**
 * Opens a session from a sign-in link. Runs only when the owner presses
 * Continue - never on a plain GET - so a link preview in WhatsApp or a mail
 * scanner cannot use it up before the owner does.
 *
 * A link the portal issued (?invite=, 0050) makes a fresh Supabase sign-in on
 * the spot, so it works each time it is opened until it expires or the owner
 * has chosen a password. Links sent before then carry Supabase's own one-time
 * token (?token_hash=) and still work once.
 */
export async function confirmLink(formData: FormData) {
  const invite = String(formData.get("invite") ?? "");
  let tokenHash = String(formData.get("token_hash") ?? "");
  let type = String(formData.get("type") ?? "");
  // Errors stay on /auth/confirm: /login forwards anyone already signed in
  // to their portal, which would hide the message.
  if (invite) {
    if (!isInviteToken(invite)) redirect("/auth/confirm?error=link_invalid");
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("owner_invites")
      .select("id, profile_id, email, created_at, expires_at, used_at")
      .eq("token_hash", hashInviteToken(invite))
      .maybeSingle();
    if (!row) redirect("/auth/confirm?error=link_invalid");
    const { data: owner } = await admin
      .from("profiles")
      .select("last_login_at, is_active")
      .eq("id", row.profile_id)
      .maybeSingle();
    if (!owner?.is_active) redirect("/auth/confirm?error=link_invalid");
    const state = checkInvite(row, owner.last_login_at, env.ownerPasswords);
    if (state !== "ok") redirect(`/auth/confirm?error=link_${state}`);

    // A fresh one-time token, spent straight away below.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: row.email,
    });
    if (linkError || !link.properties?.hashed_token) {
      console.error(`[auth] invite sign-in failed: ${linkError?.code ?? "unknown"} ${linkError?.message ?? ""}`);
      redirect("/auth/confirm?error=link_invalid");
    }
    tokenHash = link.properties.hashed_token;
    type = "recovery";
    if (!row.used_at) {
      await admin.from("owner_invites").update({ used_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
  if (!tokenHash || !LINK_TYPES.has(type)) redirect("/auth/confirm?error=link_invalid");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as "invite" | "recovery",
  });
  if (error) {
    console.error(`[auth] sign-in link refused: ${error.code ?? error.status ?? "unknown"} ${error.message}`);
    redirect("/auth/confirm?error=link_invalid");
  }

  // With owner passwords switched off the link itself is the sign-in: straight
  // into the portal. last_login_at is left alone, so switching passwords on
  // later still sends these owners to choose one.
  if (!env.ownerPasswords) {
    const [portal, profile] = await Promise.all([currentPortal(), getProfile()]);
    redirect(
      portal && profile && roleAllowedOnPortal(profile.role, portal) ? portalHome(portal) : "/auth/set-password"
    );
  }
  redirect("/auth/set-password");
}

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) redirect("/auth/set-password?error=short");
  if (password !== confirm) redirect("/auth/set-password?error=mismatch");

  const profile = await getProfile();
  if (!profile) redirect("/login?error=link_invalid");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(
      `/auth/set-password?error=${error.code === "same_password" ? "same" : "failed"}`
    );
  }

  await supabase
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", profile.id);

  const portal = await currentPortal();
  revalidatePath("/", "layout");
  redirect(
    portal && roleAllowedOnPortal(profile.role, portal) ? portalHome(portal) : WRONG_PORTAL_PATH
  );
}
