"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export type ActionState = { error?: string; success?: string };

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
  otherFees: z.union([z.literal("").transform(() => 0), z.coerce.number().min(0, "Other fees cannot be negative").max(10_000_000)]).default(0),
  otherFeesNote: z.string().trim().max(200).optional(),
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
    p_other_fees: input.otherFees,
    p_other_fees_note: input.otherFeesNote || null,
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
  status: z.enum(["draft", "issued", "approved", "paid", "void"]),
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
      issued_on: status === "issued" ? today : undefined,
      approved_by: status === "approved" ? profile.id : undefined,
      approved_at: status === "approved" ? new Date().toISOString() : undefined,
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
