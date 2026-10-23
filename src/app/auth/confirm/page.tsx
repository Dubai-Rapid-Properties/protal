import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/layout/logo";
import { confirmLink } from "../actions";
import { env } from "@/lib/env";

export const metadata = { title: "Set up your login" };

/**
 * Landing page for a sign-in link. It deliberately does nothing on load: the
 * token is spent by the Continue button (see confirmLink), so link previews
 * and scanners that fetch the URL leave it intact.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; invite?: string; type?: string; error?: string }>;
}) {
  const { token_hash: tokenHash, invite, type, error } = await searchParams;
  const valid = !error && Boolean(tokenHash || invite) && (type === "invite" || type === "recovery");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--muted)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <Logo variant="white" className="rounded-xl px-10 py-8" imageClassName="w-48" priority />
        </div>

        <Card>
          <CardContent className="space-y-4 p-6">
            {valid ? (
              <>
                <div>
                  <h1 className="text-lg font-semibold">
                    {!env.ownerPasswords
                      ? "Welcome to your owner portal"
                      : type === "invite"
                        ? "Welcome to your owner portal"
                        : "Reset your password"}
                  </h1>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {!env.ownerPasswords
                      ? "Continue to open your portal."
                      : type === "invite"
                        ? "Continue to choose the password you will use to sign in."
                        : "Continue to choose a new password."}
                  </p>
                </div>
                <form action={confirmLink}>
                  {invite ? (
                    <input type="hidden" name="invite" value={invite} />
                  ) : (
                    <input type="hidden" name="token_hash" value={tokenHash} />
                  )}
                  <input type="hidden" name="type" value={type} />
                  <Button type="submit" className="w-full">
                    Continue
                  </Button>
                </form>
              </>
            ) : error === "link_used" ? (
              <>
                <h1 className="text-lg font-semibold">Your password is already set</h1>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Sign in with your email address and password. Forgot it? Ask D|R|P for a
                  new link.
                </p>
                <Button asChild className="w-full">
                  <Link href="/login">Go to sign in</Link>
                </Button>
              </>
            ) : error ? (
              <>
                <h1 className="text-lg font-semibold">
                  {error === "link_expired" ? "This link has expired" : "This link no longer works"}
                </h1>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Sign-in links work only for a limited time, and a newer link replaces an
                  older one. Ask D|R|P to send you a new one.
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/login">Go to sign in</Link>
                </Button>
              </>
            ) : (
              <>
                <h1 className="text-lg font-semibold">This link is not complete</h1>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Open the full link from your message, or ask D|R|P to send a new one.
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/login">Go to sign in</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
