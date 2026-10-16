import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// env.ts reads process.env once, when first imported.
process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "re_test";
process.env.ADMIN_URL = "https://admin.drp.test";
process.env.OWNER_URL = "https://owner.drp.test";
process.env.NEXT_PUBLIC_APP_NAME = "D|R|P Property Management";

const { sendQueuedEmails } = await import("@/lib/notify/email");
const { isNeverEmailed, sendMessage } = await import("@/lib/messaging");

type Row = {
  id: string;
  channel: string;
  status: string;
  provider: string | null;
  to_address: string;
  subject: string;
  body: string;
  variables: { portal: string; link: string };
  queued_at: string;
  [k: string]: unknown;
};

let rows: Row[];
let sent: { to: string[]; subject: string; text: string }[];
let resendFails: boolean;

/** Just enough of the supabase-js query builder for sendQueuedEmails. */
function fakeClient() {
  return {
    from() {
      let patch: Partial<Row> | null = null;
      const filters: ((r: Row) => boolean)[] = [];
      const builder = {
        select: () => builder,
        update: (p: Partial<Row>) => ((patch = p), builder),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), builder),
        is: (k: string, v: unknown) => (filters.push((r) => r[k] === v), builder),
        order: () => builder,
        limit: () => builder,
        then(resolve: (x: { data: Row[] }) => void) {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (patch) hit.forEach((r) => Object.assign(r, patch));
          resolve({ data: hit.map((r) => ({ ...r })) });
        },
      };
      return builder;
    },
  } as never;
}

beforeEach(() => {
  sent = [];
  resendFails = false;
  rows = [
    {
      id: "m1", channel: "email", status: "queued", provider: null,
      to_address: "owner.b@example.com", subject: "New booking: Marina Gate 1 2807",
      body: "10 Nov 2026 to 15 Nov 2026 (5 nights), via Airbnb.",
      variables: { portal: "owner", link: "/portal/owner/bookings" }, queued_at: "1",
    },
    {
      id: "m2", channel: "email", status: "queued", provider: null,
      to_address: "office@drp-test.ae", subject: "New booking: Marina Gate 1 2807",
      body: "DRP-BKG-2026-0100 - 10 Nov 2026 to 15 Nov 2026 (5 nights), via Airbnb. Price not entered yet.",
      variables: { portal: "admin", link: "/bookings/b1" }, queued_at: "2",
    },
    {
      // Already claimed by a run in progress: must not be sent twice.
      id: "m3", channel: "email", status: "queued", provider: "sending",
      to_address: "twice@example.com", subject: "x", body: "x",
      variables: { portal: "owner", link: "/portal/owner/bookings" }, queued_at: "3",
    },
  ];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const payload = JSON.parse(init.body);
    if (resendFails) {
      return { ok: false, status: 422, json: async () => ({ message: "Domain not verified" }) };
    }
    sent.push({ to: payload.to, subject: payload.subject, text: payload.text });
    return { ok: true, status: 200, json: async () => ({ id: `re_${sent.length}` }) };
  }) as never;
});

test("queued emails go out once, with a link into the recipient's own portal", async () => {
  const result = await sendQueuedEmails(fakeClient());
  assert.deepEqual(result, { sent: 2, failed: 0 });
  assert.deepEqual(sent.map((s) => s.to[0]), ["owner.b@example.com", "office@drp-test.ae"]);
  assert.match(sent[0].text, /Open in the portal: https:\/\/owner\.drp\.test\/portal\/owner\/bookings/);
  assert.match(sent[1].text, /Open in the portal: https:\/\/admin\.drp\.test\/bookings\/b1/);
  assert.doesNotMatch(sent[0].text, /AED|DRP-BKG/, "owner email carries no money or booking number");

  assert.equal(rows[0].status, "sent");
  assert.equal(rows[0].provider, "resend");
  assert.equal(rows[0].provider_message_id, "re_1");
  assert.equal(rows[2].status, "queued", "a row claimed elsewhere is left alone");

  // A second run finds nothing left to send.
  assert.deepEqual(await sendQueuedEmails(fakeClient()), { sent: 0, failed: 0 });
  assert.equal(sent.length, 2);
});

test("a provider error marks the row failed with the reason, and it is not retried", async () => {
  resendFails = true;
  const result = await sendQueuedEmails(fakeClient());
  assert.deepEqual(result, { sent: 0, failed: 2 });
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].error_message, "Domain not verified");
  assert.deepEqual(await sendQueuedEmails(fakeClient()), { sent: 0, failed: 0 });
});

test("the office address is never emailed, however it is written", async () => {
  assert.equal(isNeverEmailed("office@dubairapidproperties.com"), true);
  assert.equal(isNeverEmailed("  Office@DubaiRapidProperties.com "), true);
  assert.equal(isNeverEmailed("D|R|P <office@dubairapidproperties.com>"), true);
  assert.equal(isNeverEmailed("owner@example.com"), false);

  const result = await sendMessage({ channel: "email", to: "Office@dubairapidproperties.com", body: "Hi" });
  assert.equal(result.ok, false);
  assert.equal(result.provider, "blocked");
});
