"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy, KeyRound, Mail, MessageCircle, Send, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import {
  emailPortalInvite,
  grantPortalAccess,
  revokePortalAccess,
  type InviteEmailState,
  type PortalAccessState,
} from "../portal-access-actions";

export interface PortalLogin {
  profileId: string;
  email: string | null;
  lastLoginAt: string | null;
}

function Submit({ hasLogin }: { hasLogin: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <KeyRound className="size-4" />
      {pending ? "Creating link…" : hasLogin ? "Create a new sign-in link" : "Give portal access"}
    </Button>
  );
}

function SendEmailButton({ sent }: { sent: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || sent}>
      {sent ? <Check className="size-4" /> : <Send className="size-4" />}
      {pending ? "Sending…" : sent ? "Email sent" : "Send email"}
    </Button>
  );
}

/** The branded invite, sent by the portal itself. Remounted for each new link. */
function SendInviteEmail({ ownerId, email, link }: { ownerId: string; email: string; link: string }) {
  const [state, action] = useActionState<InviteEmailState, FormData>(emailPortalInvite, {});
  React.useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.sentTo) toast.success(`Invitation emailed to ${state.sentTo}`);
  }, [state]);
  return (
    <form action={action}>
      <input type="hidden" name="ownerId" value={ownerId} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="link" value={link} />
      <SendEmailButton sent={Boolean(state.sentTo)} />
    </form>
  );
}

/**
 * Owner portal logins for one owner: who can sign in, and a one-time link to
 * set up (or reset) a login. Staff without users.manage see the list only.
 */
export function PortalAccess({
  ownerId,
  defaultEmail,
  logins,
  canManage,
  passwords,
}: {
  ownerId: string;
  defaultEmail: string | null;
  logins: PortalLogin[];
  canManage: boolean;
  /** env.ownerPasswords: whether the link leads to choosing a password. */
  passwords: boolean;
}) {
  const [state, action] = useActionState<PortalAccessState, FormData>(grantPortalAccess, {});

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const copy = async () => {
    if (!state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          Owner portal access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {logins.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No portal login yet. This owner cannot see their properties, calendar or
            bookings online.
          </p>
        ) : (
          <ul className="space-y-2">
            {logins.map((login) => (
              <li
                key={login.profileId}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{login.email ?? "—"}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {login.lastLoginAt
                      ? `Last signed in ${formatDate(login.lastLoginAt)}`
                      : "Has not signed in yet"}
                  </p>
                </div>
                {canManage && (
                  <form
                    action={revokePortalAccess}
                    onSubmit={(e) => {
                      if (!confirm(`Remove portal access for ${login.email}?`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="ownerId" value={ownerId} />
                    <input type="hidden" name="profileId" value={login.profileId} />
                    <Button type="submit" variant="ghost" size="sm">
                      <UserX className="size-4" />
                      Remove
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form action={action} className="space-y-3 border-t border-[var(--border)] pt-4">
            <input type="hidden" name="ownerId" value={ownerId} />
            <div className="space-y-1.5">
              <Label htmlFor="portal-email">Owner&apos;s email for signing in</Label>
              <Input
                id="portal-email"
                name="email"
                type="email"
                required
                defaultValue={state.email ?? defaultEmail ?? ""}
                placeholder="owner@example.com"
              />
            </div>
            <Submit hasLogin={logins.length > 0} />
            <p className="text-xs text-[var(--muted-foreground)]">
              {passwords
                ? "Creates a one-time link for the owner to set their own password. Use it again any time an owner forgets their password."
                : "Creates a one-time link that opens the owner portal directly. Create a new one each time the owner needs to open it."}
            </p>
          </form>
        )}

        {state.link && (
          <div className="space-y-3 rounded-lg border border-[var(--success)]/40 bg-[var(--success)]/10 p-3">
            <p className="text-sm font-medium">
              Link ready for {state.email}. Send it to the owner now.
            </p>
            <Input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              {state.canEmail && state.email && (
                <SendInviteEmail key={state.link} ownerId={ownerId} email={state.email} link={state.link} />
              )}
              {state.whatsappUrl && (
                <Button asChild size="sm" variant={state.canEmail ? "outline" : "default"}>
                  <a href={state.whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="size-4" />
                    Send on WhatsApp
                  </a>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <a href={state.mailtoUrl}>
                  <Mail className="size-4" />
                  {state.canEmail ? "Open in Mail" : "Send by email"}
                </a>
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={copy}>
                <Copy className="size-4" />
                Copy link
              </Button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              The link works once and expires after 24 hours (Supabase, Authentication,
              Email OTP expiration). If it expires, create a new one here.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
