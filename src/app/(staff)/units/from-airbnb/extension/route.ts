import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/session";
import { can, homePathForRole } from "@/lib/auth/rbac";
import { env } from "@/lib/env";
import { EXTENSION_FOLDER, extensionFiles } from "@/lib/airbnb/extension";
import { zip } from "@/lib/zip";

/**
 * The "D|R|P for Airbnb" browser extension as a .zip, built for this portal:
 * for staff who import listings or reservations from Airbnb.
 */
export async function GET(request: Request) {
  const profile = await requireProfile();
  if (!can(profile.role, "units.manage") && !can(profile.role, "bookings.manage")) redirect(homePathForRole(profile.role));
  let icon: Uint8Array | null = null;
  try {
    const res = await fetch(new URL("/icon-192.png", request.url), { cache: "force-cache" });
    if (res.ok && res.headers.get("content-type")?.startsWith("image/png")) icon = new Uint8Array(await res.arrayBuffer());
  } catch {
    // Without the logo Chrome shows a letter instead.
  }
  const body = zip(extensionFiles(env.adminUrl, icon));
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${EXTENSION_FOLDER}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
