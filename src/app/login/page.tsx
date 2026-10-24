import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/layout/logo";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth/session";
import { PORTAL_LABEL, portalHome, roleAllowedOnPortal } from "@/lib/portal";
import { currentPortal, WRONG_PORTAL_PATH } from "@/lib/portal-server";
import { signIn } from "./actions";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "That email and password combination was not recognised.",
  account_disabled:
    "This account has been deactivated. Contact your administrator.",
  missing: "Enter both your email address and password.",
  wrong_portal:
    "This account cannot sign in here. Owners use the owner portal; " +
    "D|R|P staff use the admin portal.",
  no_access: "This account does not have portal access. Contact your property manager.",
  link_invalid:
    "That link has expired or has already been used. Ask D|R|P to send you a new one.",
  unavailable:
    "The service is temporarily unavailable, so we could not check your sign-in. " +
    "Your details are fine - please try again shortly.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const portal = await currentPortal();
  if (!portal) notFound();

  if (!isConfigured && portal === "admin") redirect("/setup");

  // If the database cannot answer, show the form: signing in is what is needed then anyway.
  const profile = await getProfile().catch(() => null);
  if (profile) {
    redirect(roleAllowedOnPortal(profile.role, portal) ? portalHome(portal) : WRONG_PORTAL_PATH);
  }

  const error = params.error ? (ERRORS[params.error] ?? ERRORS.invalid) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--muted)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <h1 className="w-full">
            <Logo variant="white" className="rounded-xl px-10 py-8" imageClassName="w-48" priority />
          </h1>
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            {PORTAL_LABEL[portal]}
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <form action={signIn} className="space-y-4">
              <input type="hidden" name="next" value={params.next ?? ""} />

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3 text-sm"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@drp.ae"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>

              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-[var(--muted-foreground)]">
          {portal === "owner" ? (
            "New here, or forgot your password? Ask D|R|P for a sign-in link."
          ) : (
            <Link href="/setup" className="underline underline-offset-2">
              Setup guide
            </Link>
          )}
        </p>
      </div>
    </main>
  );
}
