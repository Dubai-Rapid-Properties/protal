import { NextResponse, type NextRequest } from "next/server";
import { ackStayAlarm } from "@/app/(staff)/alarm-actions";

/**
 * "Done" pressed on a phone notification. The service worker (public/sw.js)
 * cannot call a server action, so it posts here with the signed-in session.
 */
export async function POST(request: NextRequest) {
  const alarm = await request.json().catch(() => null);
  const result = await ackStayAlarm(alarm ?? {});
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
