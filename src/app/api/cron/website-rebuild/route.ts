import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rebuildWebsite } from "@/lib/website";
import { env } from "@/lib/env";

/**
 * Rebuilds the D|R|P website so it picks up Property Finder's current
 * listings (the website reads them only while it builds). Called every hour
 * by Supabase pg_cron (scripts/setup-cron.mjs): GitHub's scheduled workflow
 * in the website repo runs hours late or not at all.
 *
 * Authenticated by CRON_SECRET, and refuses to run without one, so nobody
 * else can start builds.
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

  const result = await rebuildWebsite();
  return NextResponse.json({ ok: result.started, ...result }, { status: result.started ? 200 : 502 });
}

export const GET = handle;
export const POST = handle;
