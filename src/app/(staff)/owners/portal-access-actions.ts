"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can, isStaff } from "@/lib/auth/rbac";
import { env } from "@/lib/env";
import { sendMessage, toE164 } from "@/lib/messaging";
import { buildPortalInvite } from "@/lib/notify/invite-email";
import { newInviteToken } from "@/lib/auth/owner-invite";

export type PortalAccessState = {
  error?: string;
  /** One-time link the owner opens to set their password. */
  link?: string;
  email?: string;
  whatsappUrl?: string;
  mailtoUrl?: string;
  /** The portal can send the branded email itself (Resend is set up). */
  canEmail?: boolean;
  /** How long the link works (env.ownerLinkValidHours). */
  linkValidHours?: number;
};

const emailConfigured = () =>
  env.messaging.emailProvider === "resend" && Boolean(env.messaging.resendApiKey);

async function companyForInvite(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from("company_settings")
    .select("trade_name, legal_name, registered_address, phone, email")
    .maybeSingle();
  return data;
}

const grantSchema = z.object({
  ownerId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

/**
 * Gives an owner a login to the owner portal and returns a one-time link for
 * them to set their password.
 *
 * Nothing is emailed from here: Supabase's built-in mailer only delivers to the
 * project's own team, so the link is handed back for staff to send on WhatsApp,
 * from their own mail app, or (with Resend set up) as a branded email the
 * portal sends through emailPortalInvite.
 *
 * The service key is used for one thing only, creating the auth user and its
 * link, which no user session can do. The role change and the owner link go
 * through the caller's own session, so RLS (super admin only) still decides
 * whether they are allowed.
 */
export async function grantPortalAccess(
  _prev: PortalAccessState,
  formData: FormData
): Promise<PortalAccessState> {
  const profile = await requireProfile();
  if (!can(profile.role, "users.manage")) {
    return { error: "Only a super admin can give portal access." };
  }
  if (!env.supabaseServiceRoleKey) {
    return {
      error:
        "SUPABASE_SECRET_KEY is not set in .env.local, so logins cannot be created. " +
        "Add it from Supabase -> Project Settings -> API Keys and restart the app.",
    };
  }

  const parsed = grantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const { ownerId, email } = parsed.data;

  const supabase = await createClient();

  const { data: owner } = await supabase
    .from("owners")
    .select("id, full_name, phone, whatsapp")
    .eq("id", ownerId)
    .maybeSingle();
  if (!owner) return { error: "Owner not found." };

  // Never turn a staff account into an owner login.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, role")
    // Case-insensitive, with _ and % taken literally.
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  if (existing && isStaff(existing.role)) {
    return {
      error: "That email belongs to a D|R|P staff account. Use the owner's own email address.",
    };
  }

  // A new address gets an invite link; one that already has a login gets a
  // password-reset link instead, which signs them in the same way.
  const admin = createAdminClient();
  let result = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: owner.full_name } },
  });
  let linkType: "invite" | "recovery" = "invite";
  if (result.error && (result.error.code === "email_exists" || result.error.status === 422)) {
    result = await admin.auth.admin.generateLink({ type: "recovery", email });
    linkType = "recovery";
  }
  if (result.error || !result.data.user) {
    return { error: `Could not create the login: ${result.error?.message ?? "unknown error"}` };
  }

  const userId = result.data.user.id;

  // The same check by account rather than by address: a staff login whose
  // profile spells its email differently must still never become an owner.
  const { data: account } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (account && isStaff(account.role)) {
    return {
      error: "That email belongs to a D|R|P staff account. Use the owner's own email address.",
    };
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: owner.full_name,
      phone: owner.phone,
      role: "owner",
      is_active: true,
    },
    { onConflict: "id" }
  );
  if (profileError) return { error: `Could not set the owner role: ${profileError.message}` };

  const { error: linkError } = await supabase
    .from("owner_users")
    .upsert(
      { owner_id: owner.id, profile_id: userId },
      { onConflict: "owner_id,profile_id", ignoreDuplicates: true }
    );
  if (linkError) return { error: `Could not link the login: ${linkError.message}` };

  // The link carries the portal's own token (0050), not Supabase's one-time
  // one: it signs the owner in as often as it is opened until it expires or
  // they choose a password, and Continue makes a fresh Supabase sign-in each
  // time. A new link replaces the owner's earlier ones.
  const { token, hash } = newInviteToken();
  await admin.from("owner_invites").delete().eq("profile_id", userId);
  const { error: inviteError } = await admin.from("owner_invites").insert({
    token_hash: hash,
    profile_id: userId,
    email,
    created_by: profile.id,
    expires_at: new Date(Date.now() + env.ownerLinkValidHours * 3_600_000).toISOString(),
  });
  // Until migration 0050 is in, fall back to Supabase's own one-time link.
  if (inviteError) console.error(`[owners] portal link fell back to a one-time link: ${inviteError.message}`);
  const link = `${env.ownerUrl}/auth/confirm?${new URLSearchParams(
    inviteError
      ? { token_hash: result.data.properties.hashed_token, type: linkType }
      : { invite: token, type: linkType }
  )}`;

  const invite = buildPortalInvite({
    ownerName: owner.full_name,
    email,
    link,
    portalUrl: env.ownerUrl,
    company: await companyForInvite(supabase),
    mode: env.ownerPasswords ? "password" : "link",
    linkValidHours: env.ownerLinkValidHours,
  });

  const phone = owner.whatsapp ?? owner.phone;

  revalidatePath(`/owners/${owner.id}`);
  return {
    link,
    email,
    canEmail: emailConfigured(),
    linkValidHours: env.ownerLinkValidHours,
    whatsappUrl: phone
      ? `https://wa.me/${toE164(phone).replace("+", "")}?text=${encodeURIComponent(invite.text)}`
      : undefined,
    mailtoUrl: `mailto:${email}?subject=${encodeURIComponent(invite.subject)}&body=${encodeURIComponent(
      invite.text
    )}`,
  };
}

export type InviteEmailState = { error?: string; sentTo?: string };

const inviteEmailSchema = z.object({
  ownerId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  link: z.string().url(),
});

/** Sends the branded portal invite from the portal's own address (Resend). */
export async function emailPortalInvite(
  _prev: InviteEmailState,
  formData: FormData
): Promise<InviteEmailState> {
  const profile = await requireProfile();
  if (!can(profile.role, "users.manage")) {
    return { error: "Only a super admin can send portal invitations." };
  }
  if (!emailConfigured()) {
    return { error: "Email is not set up yet (EMAIL_PROVIDER and RESEND_API_KEY)." };
  }
  const parsed = inviteEmailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Create the sign-in link first." };
  const { ownerId, email, link } = parsed.data;
  // Only a link this portal made may go out under its name.
  if (!link.startsWith(`${env.ownerUrl}/auth/confirm?`)) {
    return { error: "That is not a sign-in link from this portal." };
  }

  const supabase = await createClient();
  const { data: owner } = await supabase
    .from("owners")
    .select("full_name")
    .eq("id", ownerId)
    .maybeSingle();
  if (!owner) return { error: "Owner not found." };

  const invite = buildPortalInvite({
    ownerName: owner.full_name,
    email,
    link,
    portalUrl: env.ownerUrl,
    company: await companyForInvite(supabase),
    mode: env.ownerPasswords ? "password" : "link",
    linkValidHours: env.ownerLinkValidHours,
  });
  const result = await sendMessage({
    channel: "email",
    to: email,
    subject: invite.subject,
    body: invite.text,
    html: invite.html,
  });
  if (!result.ok || result.skipped) {
    return { error: `The email was not sent: ${result.error ?? "email is not set up"}` };
  }
  return { sentTo: email };
}

const revokeSchema = z.object({
  ownerId: z.string().uuid(),
  profileId: z.string().uuid(),
});

/**
 * Removes a login from an owner. When the login is linked to no other owner
 * it loses the owner role, so the next request it makes is signed out.
 */
export async function revokePortalAccess(formData: FormData): Promise<void> {
  const profile = await requireProfile();
  if (!can(profile.role, "users.manage")) return;

  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { ownerId, profileId } = parsed.data;

  const supabase = await createClient();
  await supabase
    .from("owner_users")
    .delete()
    .eq("owner_id", ownerId)
    .eq("profile_id", profileId);

  const { count } = await supabase
    .from("owner_users")
    .select("owner_id", { count: "exact", head: true })
    .eq("profile_id", profileId);

  if (!count) {
    await supabase
      .from("profiles")
      .update({ role: "guest" })
      .eq("id", profileId)
      .eq("role", "owner");
  }

  revalidatePath(`/owners/${ownerId}`);
}
