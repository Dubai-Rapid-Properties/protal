import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/database.types";
import { isTransientFailure } from "@/lib/auth/errors";

/** Refresh this many seconds before the access token actually expires. */
const REFRESH_MARGIN_SECONDS = 120;

/**
 * Reads the access token's expiry from the session cookie without a network
 * call and without verifying the signature.
 *
 * This is only ever used to decide *whether a refresh is due*. It is never an
 * authorisation decision: PostgREST verifies the signature on every query, and
 * RLS decides what the row set is. A forged or tampered cookie gets past this
 * check and then receives nothing from the database - `current_profile()`
 * returns no row and the page redirects to the login screen.
 *
 * Returns null when the cookie is absent or unparseable, which callers treat
 * as "refresh needed".
 */
function accessTokenExpiry(request: NextRequest): number | null {
  const cookie = request.cookies
    .getAll()
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    // Large sessions are split across .0, .1 … chunks that must be rejoined.
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join("");

  if (!cookie) return null;

  try {
    const raw = cookie.startsWith("base64-")
      ? Buffer.from(cookie.slice("base64-".length), "base64").toString("utf8")
      : decodeURIComponent(cookie);

    const session = JSON.parse(raw) as { access_token?: string };
    const token = session.access_token;
    if (!token) return null;

    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString("utf8")
    ) as { exp?: number };

    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Refreshes the Supabase session cookie when it is close to expiring, and gates
 * the authenticated surface.
 *
 * Any call to Supabase Auth costs a full round trip to the project's region.
 * Doing it on every request added a round trip to every page for no benefit
 * while the token was still valid, so it now runs only when a refresh is
 * actually due - and then as a single call.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh. Let the request
  // through so the setup screen can explain what is missing.
  if (!url || !key) return response;

  const path = request.nextUrl.pathname;

  // Machine endpoints (scheduler, website API, iCal feeds) never carry a
  // browser session and authenticate themselves (CRON_SECRET, CORS and rate
  // limits, secret feed tokens); skip the session logic for them entirely.
  if (
    path.startsWith("/api/cron/") ||
    path.startsWith("/api/public/") ||
    path.startsWith("/api/ical/") ||
    path.startsWith("/api/keep-alive")
  ) {
    return response;
  }

  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/setup") ||
    path === "/";

  const exp = accessTokenExpiry(request);
  const now = Math.floor(Date.now() / 1000);
  const hasLiveToken = exp !== null && exp - now > REFRESH_MARGIN_SECONDS;

  if (!hasLiveToken) {
    const supabase = createServerClient<Database>(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    // getSession() renews an expiring token in one round trip; getUser()
    // would add a second one to re-fetch the user. The result only decides
    // whether to send the visitor to /login - it is never an authorisation
    // decision, because PostgREST verifies the JWT on every query and RLS
    // decides the row set.
    let { data: { session }, error } = await supabase.auth.getSession();

    // The refresh did not get an answer (a network blip, a 5xx): try once more before concluding
    // anything. The session is not dropped for this kind of failure, only for a refused token.
    if (!session && isTransientFailure(error)) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      ({ data: { session }, error } = await supabase.auth.getSession());
    }

    if (!session && !isPublic) {
      if (isTransientFailure(error)) {
        // Still no answer, and nothing says the session is over: carry on rather than sign out.
        // The cookie stays, so the next request refreshes it.
        console.warn(`[auth] session refresh not answered, request let through: ${error?.message}`);
        return response;
      }
      console.warn(`[auth] no valid session, sent to sign-in: ${error?.message ?? "no session cookie"}`);
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.searchParams.set("next", path);
      return NextResponse.redirect(redirect);
    }
  }

  return response;
}
