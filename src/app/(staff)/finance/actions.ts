"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { env } from "@/lib/env";
import { sendMessage } from "@/lib/messaging";
import { dubaiToday } from "@/lib/calendar";
import { flushEmailsSoon } from "@/lib/notify/flush";
import { buildStatementEmail } from "@/lib/statements/email";

export type ActionState = { error?: string; success?: string };

/** Fees item by item - what each is for and its amount - as the dialog sends them (JSON). */
const feeItems = (what: string) =>
  z
    .string()
    .default("[]")
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: `Check the ${what}s.` });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(
          z.object({
            description: z.string().trim().min(1, `Say what each ${what} is for`).max(200),
            amount: z.coerce.number().positive(`Each ${what} needs an amount above 0`).max(10_000_000),
          })
        )
        .max(50)
    );

const statementSchema = z.object({
  ownerId: z.string().uuid("Select an owner"),
  periodStart: z.string().min(1, "Period start is required"),
  periodEnd: z.string().min(1, "Period end is required"),
  // Set per statement: the fee differs from owner to owner (0054).
  feePct: z.coerce
    .number({ message: "Enter the management fee %" })
    .min(0, "The management fee cannot be negative")
    .max(100, "The management fee cannot be over 100%"),
  feeVat: z.literal("on").optional(),
  // Utility fees (0055): each listed for the owner under its own name.
  otherItems: feeItems("utility fee"),
  // Other fees (0056, 0057): kept for staff; never on the owner's statement, not deducted.
  otherCharges: feeItems("other fee"),
});

/**
 * Generates an owner statement for a period.
 *
 * The arithmetic lives in the database function generate_owner_statement, not
 * here: it snapshots every ledger line onto the statement and marks those lines
 * as carried, so the same income can never appear on two statements and a
 * re-issue cannot silently restate history.
 */
export async function generateStatement(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "statements.issue")) {
    return { error: "Only finance and administrators may issue owner statements." };
  }

  const parsed = statementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const input = parsed.data;

  if (new Date(input.periodEnd) < new Date(input.periodStart)) {
    return { error: "The period end cannot fall before the period start." };
  }

  const supabase = await createClient();
  // Every ended stay's income must be in the ledger before the statement is cut.
  const { error: postError } = await supabase.rpc("post_completed_bookings");
  if (postError) return { error: postError.message };
  const { data, error } = await supabase.rpc("generate_owner_statement", {
    p_owner_id: input.ownerId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_fee_pct: input.feePct,
    p_fee_vat: input.feeVat === "on",
    p_other_items: input.otherItems.map((i) => ({ description: i.description, amount: Math.round(i.amount * 100) / 100 })),
    p_other_charges: input.otherCharges.map((i) => ({ description: i.description, amount: Math.round(i.amount * 100) / 100 })),
  });

  if (error) {
    if (error.message.includes("already exists")) {
      return {
        error:
          "A statement already covers this owner and period. Void the existing one before regenerating.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/finance/statements");
  redirect(`/finance/statements/${data as string}`);
}

const statusSchema = z.object({
  statementId: z.string().uuid(),
  // A draft reaches the owner only through the approver (approveAndSendStatement).
  status: z.enum(["paid", "void"]),
});

export async function updateStatementStatus(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "statements.issue")) {
    return { error: "Only finance and administrators may change statement status." };
  }

  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { statementId, status } = parsed.data;

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();

  const { data: changed, error } = await supabase
    .from("owner_statements")
    .update({
      status,
      paid_on: status === "paid" ? today : undefined,
    })
    .eq("id", statementId)
    .select("id");

  if (error) return { error: error.message };
  if (!changed?.length) return { error: "This statement could not be changed. You may not have access to it." };

  revalidatePath(`/finance/statements/${statementId}`);
  revalidatePath("/finance/statements");
  return { success: `Statement marked ${status}.` };
}

const ledgerSchema = z.object({
  unitId: z.string().uuid("Select a unit"),
  categoryId: z.string().uuid("Select a category"),
  direction: z.enum(["income", "expense"]),
  entryDate: z.string().min(1, "Date is required"),
  description: z.string().min(2, "Describe the entry").max(300),
  amount: z.coerce.number().min(0.01, "Amount must be greater than zero"),
  vatApplicable: z.boolean().default(false),
});

/**
 * Records an income or expense against a unit.
 *
 * VAT is decided per entry rather than globally: residential rent is exempt
 * while a management fee or a furnishing service on the same unit is standard
 * rated. The default comes from the GL category; the operator can override it.
 */
export async function createLedgerEntry(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "finance.manage")) {
    return { error: "You do not have permission to post to the ledger." };
  }

  const parsed = ledgerSchema.safeParse({
    ...Object.fromEntries(formData),
    vatApplicable: formData.get("vatApplicable") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const input = parsed.data;

  const supabase = await createClient();

  // Attribute the entry to the unit's current primary owner so it lands on the
  // right statement.
  const { data: ownership } = await supabase
    .from("unit_ownerships")
    .select("owner_id")
    .eq("unit_id", input.unitId)
    .is("end_date", null)
    .order("is_primary_contact", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("ledger_entries").insert({
    entry_date: input.entryDate,
    unit_id: input.unitId,
    owner_id: ownership?.owner_id ?? null,
    category_id: input.categoryId,
    direction: input.direction,
    description: input.description,
    amount_aed: input.amount,
    vat_applicable: input.vatApplicable,
    recorded_by: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/finance");
  return { success: "Ledger entry posted." };
}

/** The one account allowed to delete owner statements (0054). */
const STATEMENT_DELETER = "dulshan@dubairapidproperties.com";

export const canDeleteStatements = async (email: string | null | undefined) =>
  (email ?? "").trim().toLowerCase() === STATEMENT_DELETER;

/**
 * Deletes a statement outright, with its lines; the income it carried is
 * free for a new statement. Only dulshan@dubairapidproperties.com - the
 * database checks the same.
 */
export async function deleteStatement(statementId: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (!(await canDeleteStatements(profile.email))) {
    return { error: "Only dulshan@dubairapidproperties.com can delete a statement." };
  }
  if (!z.string().uuid().safeParse(statementId).success) return { error: "Statement not found." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_owner_statement", { p_statement_id: statementId });
  if (error) return { error: error.message };

  revalidatePath("/finance/statements");
  redirect("/finance/statements");
}


const statementIdSchema = z.string().uuid();

/** Whether this login approves statements (0060): the approver set in Company settings, else any super admin. */
export async function canApproveStatements(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_approve_statements");
  return data === true;
}

/** The office sends a draft to the approver, who sees it on Owner statements (and is notified). */
export async function submitStatement(statementId: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "statements.issue")) return { error: "Only finance and administrators can send a statement for approval." };
  if (!statementIdSchema.safeParse(statementId).success) return { error: "Statement not found." };

  const supabase = await createClient();
  const { data: changed, error } = await supabase
    .from("owner_statements")
    .update({ submitted_at: new Date().toISOString(), submitted_by: profile.id, return_note: null })
    .eq("id", statementId)
    .eq("status", "draft")
    .is("submitted_at", null)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: "Only a draft that is not already waiting can be sent for approval." };

  flushEmailsSoon();
  revalidatePath(`/finance/statements/${statementId}`);
  revalidatePath("/finance/statements");
  return { success: "Sent for approval." };
}

/** The approver sends a draft back to the office, with what to change. */
export async function returnStatement(statementId: string, note: string): Promise<ActionState> {
  await requireProfile();
  if (!(await canApproveStatements())) return { error: "Only the statement approver can send a statement back." };
  if (!statementIdSchema.safeParse(statementId).success) return { error: "Statement not found." };

  const supabase = await createClient();
  const { data: changed, error } = await supabase
    .from("owner_statements")
    .update({ submitted_at: null, return_note: note.trim().slice(0, 500) || null })
    .eq("id", statementId)
    .eq("status", "draft")
    .not("submitted_at", "is", null)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: "This statement is not waiting for approval." };

  flushEmailsSoon();
  revalidatePath(`/finance/statements/${statementId}`);
  revalidatePath("/finance/statements");
  return { success: "Sent back to the office." };
}

/**
 * The approver approves a statement waiting for approval and emails it to
 * the owner: the summary and the booking breakdown, in the email itself.
 * Nothing changes unless the email went out.
 */
export async function approveAndSendStatement(statementId: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (!(await canApproveStatements())) return { error: "Only the statement approver can approve a statement." };
  if (!statementIdSchema.safeParse(statementId).success) return { error: "Statement not found." };

  const supabase = await createClient();
  const [{ data: statement }, { data: lines }, { data: company }] = await Promise.all([
    supabase.from("owner_statements").select("*, owners(full_name, email)").eq("id", statementId).maybeSingle(),
    supabase.from("owner_statement_lines").select("*").eq("statement_id", statementId).order("sort_order"),
    supabase
      .from("company_settings")
      .select("trade_name, legal_name, registered_address, phone, email, vat_rate")
      .maybeSingle(),
  ]);
  if (!statement) return { error: "Statement not found." };
  if (statement.status !== "draft" || !statement.submitted_at) {
    return { error: "Only a statement waiting for approval can be approved." };
  }
  const to = statement.owners?.email?.trim();
  if (!to) return { error: "The owner has no email address. Add it on the owner's page, then approve." };

  const message = buildStatementEmail({
    statement,
    lines: lines ?? [],
    ownerName: statement.owners?.full_name ?? "Owner",
    company,
    portalUrl: env.ownerUrl,
  });
  const result = await sendMessage({ channel: "email", to, subject: message.subject, body: message.text, html: message.html });
  if (!result.ok || result.skipped) {
    return { error: `The statement was not sent: ${result.error ?? "email is not set up"}` };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("owner_statements")
    .update({
      status: "issued",
      issued_on: dubaiToday(),
      approved_by: profile.id,
      approved_at: now,
      sent_at: now,
      sent_to: to,
    })
    .eq("id", statementId);
  if (error) return { error: `The email went to ${to}, but the statement was not marked sent: ${error.message}` };

  flushEmailsSoon();
  revalidatePath(`/finance/statements/${statementId}`);
  revalidatePath("/finance/statements");
  return { success: `Approved and sent to ${to}.` };
}
