import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { websiteAuthError } from "@/lib/website-api";
import { leadFromWebsite } from "@/lib/leads";

/**
 * POST /api/public/enquiries - a form sent on the D|R|P website, saved as a
 * lead (Leads in the portal). Called server to server by the website's own
 * /api/enquiry route with WEBSITE_API_KEY, never from a browser.
 *
 * Body: the form's fields as JSON, e.g. {"form":"contact","name":...}.
 * Job applications and newsletter sign-ups are not leads: answered 200 with
 * saved: false.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 20_000;

export async function POST(request: Request) {
  const denied = websiteAuthError(request);
  if (denied) return denied;

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413, headers: NO_STORE });
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Send the form's fields as JSON." }, { status: 400, headers: NO_STORE });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "Send the form's fields as JSON." }, { status: 400, headers: NO_STORE });
  }

  const lead = leadFromWebsite(data as Record<string, unknown>);
  if (!lead) return NextResponse.json({ ok: true, saved: false }, { headers: NO_STORE });

  const { data: row, error } = await createAdminClient().from("leads").insert(lead).select("id").single();
  if (error) {
    console.error(`[enquiries] lead not saved: ${error.message}`);
    return NextResponse.json({ error: "The enquiry could not be saved." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, saved: true, id: row.id }, { status: 201, headers: NO_STORE });
}
