import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { pushStayAlarms } from "@/lib/push/stay-alarms";
import { env } from "@/lib/env";

/**
 * Check-out / check-in alarms for phones with the portal closed (0043).
 * Called every two minutes by Supabase pg_cron (scripts/setup-cron.mjs);
 * each ring nobody has answered is pushed again until someone presses Done.
 *
 * Authenticated by CRON_SECRET, and refuses to run without one.
 */
export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: NextRequest) {
  if (!env.cronSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorised(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await pushStayAlarms(createAdminClient());
    return NextResponse.json({ ok: result.failed === 0, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
