import { env } from "@/lib/env";

/**
 * Tells the Holiday Homes website that staff accepted ("confirmed") or declined / cancelled
 * ("cancelled") a booking made there. A request paid online has the guest's card held, not charged:
 * accepting takes the payment, declining releases the hold. The website goes first, so a booking is
 * never confirmed here without the money, nor cancelled with the card still held.
 *
 * `missing`: the website has no such booking (made before it kept them, or removed), so the portal
 * goes ahead on its own.
 */
export async function tellWebsite(
  ref: string,
  status: "confirmed" | "cancelled",
  reason?: string,
  base = env.holidayHomesUrl,
  key = env.websiteApiKey
): Promise<{ ok: true } | { missing: true } | { error: string }> {
  if (!key) return { error: "WEBSITE_API_KEY is not set, so the website can't be told. Nothing was changed." };
  let res: Response;
  try {
    res = await fetch(`${base}/api/portal/bookings/${encodeURIComponent(ref)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { error: "The Holiday Homes website couldn't be reached. Nothing was changed; please try again." };
  }
  if (res.ok) return { ok: true };
  if (res.status === 404) return { missing: true };
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return { error: body?.error ?? `The Holiday Homes website answered HTTP ${res.status}. Nothing was changed.` };
}
