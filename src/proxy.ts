import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isPathAllowed, portalForRequest } from "@/lib/portal";
import { env } from "@/lib/env";

export async function proxy(request: NextRequest) {
  const portal = portalForRequest(
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
    env.portalFallback
  );

  // Decided before any Supabase call: a path that does not belong on this host
  // costs nothing and reveals nothing. Rewriting to a route that does not exist
  // renders the app's standard 404 page with a 404 status.
  if (!isPathAllowed(portal, request.nextUrl.pathname)) {
    const notFound = request.nextUrl.clone();
    notFound.pathname = "/__not-found";
    return NextResponse.rewrite(notFound, { status: 404 });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    //
    // The manifest and icons must be listed too: the browser fetches them on
    // every page load, and without an exemption each one is redirected to
    // /login, costing a round trip and leaving the PWA manifest unreadable.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|.*\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
