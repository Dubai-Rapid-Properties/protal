import { NextResponse, type NextRequest } from "next/server";
import { ackStayAlarm } from "@/app/(staff)/alarm-actions";

/**
 * "Done" pressed on a phone notification: one alarm, or a list of them. The service worker (public/sw.js)
 * cannot call a server action, so it posts here with the signed-in session.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  /* Tomorrow's check-ins come as one notification, so its Done answers a list */
  const alarms: unknown[] = Array.isArray(body) ? body.slice(0, 50) : [body ?? {}];
  const results = await Promise.all(alarms.map((a) => ackStayAlarm(a as Parameters<typeof ackStayAlarm>[0])));
  const error = results.find((r) => r.error)?.error;
  return NextResponse.json(error ? { error } : {}, { status: error ? 400 : 200 });
}
