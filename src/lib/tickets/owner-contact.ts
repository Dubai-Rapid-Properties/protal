import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { env } from "@/lib/env";
import { sendMessage } from "@/lib/messaging";

/**
 * Reminders to contact the owner about a new repair or complaint (0065).
 * Until staff mark a ticket "Owner contacted", the operations inbox is emailed
 * every two hours, like an alarm that keeps ringing. The portal's two-minute
 * scheduler (/api/cron/stay-alarms) runs remindOwnerContacts.
 */

type Client = SupabaseClient<Database>;

export const OWNER_CONTACT_EVERY_HOURS = 2;

export type OwnerContact = { name: string; phone: string | null; email: string | null };

export type DueTicket = {
  id: string;
  ticket_number: string;
  title: string;
  kind: string;
  priority: string;
  unit_id: string;
  reported_at: string;
  reminders_sent: number;
  previous_reminded_at: string | null;
};

const dubaiTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Dubai",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The reminder email: which ticket, whose owner, how to reach them, and how to stop it. */
export function ownerContactReminder(
  ticket: DueTicket,
  unitLabel: string,
  owners: OwnerContact[],
  adminUrl = env.adminUrl
): { subject: string; body: string } {
  const what = ticket.kind === "complaint" ? "complaint" : "repair";
  const hours = Math.max(1, Math.round((Date.now() - Date.parse(ticket.reported_at)) / 3_600_000));
  const ownerLines = owners.length
    ? owners.map((o) => `  ${o.name}${[o.phone, o.email].filter(Boolean).length ? ` - ${[o.phone, o.email].filter(Boolean).join(", ")}` : ""}`)
    : ["  No owner is recorded for this unit."];
  return {
    subject: `Contact the owner: ${ticket.ticket_number} ${unitLabel}`,
    body: [
      `The owner has not been contacted yet about this ${what} (reminder ${ticket.reminders_sent}).`,
      "",
      `${ticket.ticket_number} - ${ticket.title}`,
      `Unit: ${unitLabel}`,
      `Priority: ${ticket.priority}`,
      `Reported: ${dubaiTime(ticket.reported_at)} (about ${hours} hour${hours === 1 ? "" : "s"} ago)`,
      "",
      `Owner:`,
      ...ownerLines,
      "",
      `Open the ticket: ${adminUrl}/maintenance/${ticket.id}`,
      "",
      `Once you have spoken to the owner, mark "Owner contacted" on the ticket to stop these reminders. Until then one comes every ${OWNER_CONTACT_EVERY_HOURS} hours.`,
    ].join("\n"),
  };
}

/** The current owners of each unit, primary contact first. */
async function ownersOf(admin: Client, unitIds: string[]): Promise<Map<string, OwnerContact[]>> {
  const { data } = await admin
    .from("unit_ownerships")
    .select("unit_id, is_primary_contact, owners(full_name, phone, whatsapp, email)")
    .in("unit_id", unitIds)
    .is("end_date", null)
    .order("is_primary_contact", { ascending: false });
  const byUnit = new Map<string, OwnerContact[]>();
  for (const row of data ?? []) {
    const o = row.owners;
    if (!o) continue;
    const list = byUnit.get(row.unit_id) ?? [];
    list.push({ name: o.full_name, phone: o.phone || o.whatsapp, email: o.email });
    byUnit.set(row.unit_id, list);
  }
  return byUnit;
}

/** Emails operations about every ticket due a reminder; one that can't be sent is tried again next run. */
export async function remindOwnerContacts(admin: Client): Promise<{ sent: number; failed: number }> {
  const { data, error } = await admin.rpc("claim_owner_contact_reminders", {
    p_every: `${OWNER_CONTACT_EVERY_HOURS} hours`,
  });
  if (error) throw new Error(error.message);
  const due = (data ?? []) as DueTicket[];
  if (!due.length) return { sent: 0, failed: 0 };

  const unitIds = [...new Set(due.map((t) => t.unit_id))];
  const [{ data: units }, owners] = await Promise.all([
    admin.from("units").select("id, unit_number, properties(name)").in("id", unitIds),
    ownersOf(admin, unitIds),
  ]);
  const unitLabel = new Map(
    (units ?? []).map((u) => [u.id, `${u.properties?.name ?? ""} ${u.unit_number}`.trim()])
  );

  let sent = 0;
  let failed = 0;
  for (const ticket of due) {
    const { subject, body } = ownerContactReminder(ticket, unitLabel.get(ticket.unit_id) ?? "", owners.get(ticket.unit_id) ?? []);
    const result = await sendMessage({ channel: "email", to: env.operationsEmail, subject, body });
    if (result.ok) {
      sent++;
      continue;
    }
    failed++;
    console.error(`[owner-contact] ${ticket.ticket_number}: ${result.error}`);
    // Not sent: put the clock back so the next run (two minutes on) tries again.
    await admin
      .from("maintenance_requests")
      .update({ owner_reminded_at: ticket.previous_reminded_at, owner_reminders_sent: ticket.reminders_sent - 1 })
      .eq("id", ticket.id);
  }
  return { sent, failed };
}
