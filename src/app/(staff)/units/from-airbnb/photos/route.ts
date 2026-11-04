import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { MAX_IMPORTED_PHOTOS, parseAirbnbListing } from "@/lib/airbnb/listing-page";
import { downloadAirbnbPhoto } from "@/lib/airbnb/listing-photos";
import { slugify } from "@/lib/listings";
import { imagesOf } from "@/lib/website-homes";
import { storeWebsitePhoto } from "@/lib/website-photos";

/**
 * POST /units/from-airbnb/photos - the "D|R|P for Airbnb" extension's "Copy
 * all photos": for each listing in turn, the extension reads the listing page
 * in the staff member's Airbnb tab and sends it here. The unit whose Airbnb
 * calendar is that listing gets the listing's photos, in Airbnb's order, as
 * its Holiday Homes website gallery; photos added in the portal stay, after
 * them. Photos are copied to the portal's bucket (the website never loads
 * Airbnb's copies) a few per call: the answer says how many are left, and
 * the extension sends the listing again until none are.
 *
 * Runs as the signed-in staff member, like the price sync next to it.
 */
const MAX_BODY = 500_000;
const COPIES_PER_CALL = 6;

export type PhotosAnswer =
  | { status: "saved"; unit: string; photos: number; left: number; failed: number }
  | { status: "unchanged"; unit: string; photos: number }
  | { status: "skipped" | "signin" | "error"; message: string };

const answer = (body: PhotosAnswer, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function fromExtension(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (/^(chrome|moz|safari-web)-extension:\/\//.test(origin)) return true;
  return origin === new URL(request.url).origin;
}

/** The part of a stored photo's address that names the Airbnb file it was copied from (storeWebsitePhoto). */
const copiedAs = (airbnbUrl: string) => {
  const name = `airbnb-${airbnbUrl.split("/").pop() || "airbnb-photo"}`;
  return `-${slugify(name.replace(/\.[^.]+$/, "")).slice(0, 40) || "photo"}.`;
};

export async function POST(request: Request) {
  if (!fromExtension(request) || !request.headers.get("content-type")?.startsWith("application/json")) {
    return answer({ status: "error", message: "Only the D|R|P extension can send photos here." }, 403);
  }
  const profile = await getProfile().catch(() => null);
  if (!profile) return answer({ status: "signin", message: "Sign in to the D|R|P portal in this browser to copy photos." }, 401);
  if (!can(profile.role, "units.manage")) {
    return answer({ status: "skipped", message: "Your portal account cannot change unit photos." }, 403);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return answer({ status: "error", message: "The page sent too much." }, 413);
  let sent: unknown;
  try {
    sent = JSON.parse(raw);
  } catch {
    return answer({ status: "error", message: "The page could not be read." }, 400);
  }

  const listing = parseAirbnbListing(sent);
  if (!listing.listingId) return answer({ status: "skipped", message: "Not a listing page." });
  const airbnb = listing.photos.slice(0, MAX_IMPORTED_PHOTOS);
  if (!airbnb.length) return answer({ status: "skipped", message: "No photos were found on the listing page." });

  const supabase = await createClient();
  const { data: units, error: findError } = await supabase
    .from("units")
    .select("id, unit_number, website_images, properties(name)")
    .eq("is_active", true)
    .in("operating_mode", ["short_term", "both"])
    .ilike("airbnb_ical_url", `%/${listing.listingId}.ics%`)
    .limit(2);
  if (findError) return answer({ status: "error", message: findError.message }, 500);
  if (!units?.length) {
    return answer({ status: "skipped", message: `No unit has Airbnb listing ${listing.listingId} as its calendar.` });
  }
  if (units.length > 1) {
    return answer({ status: "skipped", message: `More than one unit uses Airbnb listing ${listing.listingId}; photos were not copied.` });
  }
  const u = units[0];
  const label = [u.properties?.name, u.unit_number].filter(Boolean).join(" · ");
  const current = imagesOf(u);

  /* Each Airbnb photo already copied, or copied now (a few per call) */
  const copied = new Map<string, string>();
  for (const src of airbnb) {
    const have = current.find((url) => url.includes(copiedAs(src)));
    if (have) copied.set(src, have);
  }
  const missing = airbnb.filter((src) => !copied.has(src));
  let failed = 0;
  const batch = missing.slice(0, COPIES_PER_CALL);
  const results = await Promise.all(
    batch.map(async (src) => {
      const photo = await downloadAirbnbPhoto(src);
      if ("error" in photo) return { src, error: photo.error };
      return { src, ...(await storeWebsitePhoto(supabase, photo.bytes, photo.type, photo.name)) };
    })
  );
  for (const r of results) {
    if ("url" in r && r.url) copied.set(r.src, r.url);
    else failed++;
  }

  const fromAirbnb = airbnb.map((src) => copied.get(src)).filter((x): x is string => Boolean(x));
  const own = current.filter((url) => !fromAirbnb.includes(url) && !/-airbnb-/.test(url));
  const images = [...fromAirbnb, ...own];
  const left = missing.length - batch.length;
  if (JSON.stringify(images) === JSON.stringify(current)) {
    return left || failed
      ? answer({ status: "saved", unit: label, photos: images.length, left, failed })
      : answer({ status: "unchanged", unit: label, photos: images.length });
  }

  const { data, error } = await supabase.from("units").update({ website_images: images }).eq("id", u.id).select("id");
  if (error) return answer({ status: "error", message: error.message }, 500);
  if (!data?.length) return answer({ status: "skipped", message: "Your portal account cannot change this unit." }, 403);
  console.info(`[airbnb-photos] ${profile.id} set ${images.length} photos on ${label} (listing ${listing.listingId})`);
  revalidatePath(`/units/${u.id}`);
  return answer({ status: "saved", unit: label, photos: images.length, left, failed });
}
