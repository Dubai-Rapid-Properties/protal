import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// env.ts reads process.env once, when first imported.
process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "re_test";
process.env.ADMIN_URL = "https://admin.drp.test";
delete process.env.OPERATIONS_EMAIL;

const { ownerContactReminder, remindOwnerContacts } = await import("@/lib/tickets/owner-contact");

const TICKET = {
  id: "t1",
  ticket_number: "DRP-MR-2026-0042",
  title: "AC not cooling",
  kind: "repair",
  priority: "high",
  unit_id: "u1",
  reported_at: new Date(Date.now() - 2.1 * 3_600_000).toISOString(),
  reminders_sent: 1,
  previous_reminded_at: null,
};

let sent: { p_ticket: string; p_title: string; p_body: string }[];
let notifyFails: boolean;
let updates: { id: unknown; patch: Record<string, unknown> }[];

/** Just enough of supabase-js for remindOwnerContacts. */
function fakeClient(due: unknown[]) {
  const tables: Record<string, unknown[]> = {
    units: [{ id: "u1", unit_number: "2807", properties: { name: "Marina Gate 1" } }],
    unit_ownerships: [
      { unit_id: "u1", is_primary_contact: true, owners: { full_name: "Amal Perera", phone: "+971 50 123 4567", whatsapp: null, email: "amal@example.com" } },
    ],
  };
  return {
    rpc: async (name: string, args: never) => {
      if (name === "notify_owner_contact") {
        if (notifyFails) return { data: null, error: { message: "db down" } };
        sent.push(args);
        return { data: 2, error: null };
      }
      assert.equal(name, "claim_owner_contact_reminders");
      assert.deepEqual(args, { p_every: "2 hours" });
      return { data: due, error: null };
    },
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      const builder = {
        select: () => builder,
        in: () => builder,
        is: () => builder,
        order: () => builder,
        update: (p: Record<string, unknown>) => ((patch = p), builder),
        eq: (_k: string, id: unknown) => {
          if (patch) updates.push({ id, patch });
          return builder;
        },
        then(resolve: (x: { data: unknown[] }) => void) {
          resolve({ data: tables[table] ?? [] });
        },
      };
      return builder;
    },
  } as never;
}

beforeEach(() => {
  sent = [];
  updates = [];
  notifyFails = false;
  globalThis.fetch = (async () => {
    throw new Error("no email is sent");
  }) as typeof fetch;
});

test("the reminder names the ticket, the owner to call and how to stop it", () => {
  const { subject, body } = ownerContactReminder(TICKET, "Marina Gate 1 2807", [
    { name: "Amal Perera", phone: "+971 50 123 4567", email: "amal@example.com" },
  ]);
  assert.equal(subject, "Contact the owner: DRP-MR-2026-0042 Marina Gate 1 2807");
  assert.match(body, /has not been contacted yet about this repair \(reminder 1\)/);
  assert.match(body, /Amal Perera - \+971 50 123 4567, amal@example\.com/);
  assert.match(body, /about 2 hours ago/);
  assert.match(body, /https:\/\/admin\.drp\.test\/maintenance\/t1/);
  assert.match(body, /mark "Owner contacted" on the ticket to stop these reminders/);
  assert.match(ownerContactReminder(TICKET, "X", []).body, /No owner is recorded for this unit/);
});

test("due tickets notify the ticket's staff, not an email", async () => {
  const result = await remindOwnerContacts(fakeClient([TICKET]));
  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].p_ticket, "t1");
  assert.match(sent[0].p_title, /DRP-MR-2026-0042 Marina Gate 1 2807/);
  assert.match(sent[0].p_body, /Amal Perera, \+971 50 123 4567/);
  assert.deepEqual(updates, []);
});

test("a reminder that can't be sent is tried again on the next run", async () => {
  notifyFails = true;
  const result = await remindOwnerContacts(fakeClient([{ ...TICKET, reminders_sent: 3, previous_reminded_at: "2026-10-29T08:00:00Z" }]));
  assert.deepEqual(result, { sent: 0, failed: 1 });
  assert.deepEqual(updates, [
    { id: "t1", patch: { owner_reminded_at: "2026-10-29T08:00:00Z", owner_reminders_sent: 2 } },
  ]);
});

test("nothing due, nothing sent", async () => {
  assert.deepEqual(await remindOwnerContacts(fakeClient([])), { sent: 0, failed: 0 });
  assert.equal(sent.length, 0);
});
