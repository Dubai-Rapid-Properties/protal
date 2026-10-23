"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TICKET_CATEGORIES } from "@/lib/labels";
import type { Enums } from "@/lib/db/database.types";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

/** `id`: the ticket reportIssue made; the form then sends its photos and opens it. */
export type ActionState = { error?: string; success?: string; id?: string };

const schema = z.object({
  ticketId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  approvedAmount: z.coerce.number().min(0).optional(),
  reason: z.string().max(500).optional(),
});

/**
 * Owner decision on a maintenance quote.
 *
 * The database refuses to move a ticket past 'approved' while the approval
 * timestamp is null, so this is the only route by which above-threshold work
 * can begin - the UI cannot bypass it and neither can staff.
 */
export async function decideMaintenance(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireRole(["owner"]);

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { ticketId, decision, approvedAmount, reason } = parsed.data;

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data: changed, error } = await supabase
    .from("maintenance_requests")
    .update(
      decision === "approve"
        ? {
            owner_approved_at: now,
            owner_approved_by: profile.id,
            approved_amount_aed: approvedAmount ?? null,
            status: "approved",
          }
        : {
            owner_rejected_at: now,
            owner_rejection_reason: reason ?? null,
            status: "rejected",
          }
    )
    .eq("id", ticketId)
    // A quote is decided once: the same rule the portal uses to offer it.
    .is("owner_approved_at", null)
    .is("owner_rejected_at", null)
    .select("id");

  if (error) return { error: error.message };
  if (!changed?.length) {
    return { error: "This quote is no longer waiting for your decision. Reload the page to see where it stands." };
  }

  revalidatePath("/portal/owner/maintenance");
  revalidatePath(`/portal/owner/maintenance/${ticketId}`);
  revalidatePath("/portal/owner");
  revalidatePath(`/maintenance/${ticketId}`);
  return {
    success:
      decision === "approve"
        ? "Approved. Your property manager has been notified and work can begin."
        : "Declined. Your property manager has been notified.",
  };
}

const reportSchema = z
  .object({
    unitId: z.string().uuid("Choose the property"),
    kind: z.enum(["repair", "complaint"]),
    category: z.string(),
    priority: z.enum(["low", "medium", "high", "emergency"]),
    title: z.string().trim().min(3, "Give it a short title").max(150),
    description: z.string().trim().max(4000).optional(),
    accessNotes: z.string().trim().max(1000).optional(),
  })
  .refine((t) => (TICKET_CATEGORIES[t.kind] as string[]).includes(t.category), {
    message: "Choose a category",
    path: ["category"],
  });

/**
 * An owner reports a repair or complaint on one of their properties. It goes
 * through raise_owner_ticket, which checks ownership and fixes who raised it
 * and its starting status; D|R|P is notified by the database.
 */
export async function reportIssue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["owner"]);
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const t = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("raise_owner_ticket", {
    p_unit_id: t.unitId,
    p_kind: t.kind,
    p_category: t.category as Enums<"maintenance_category">,
    p_priority: t.priority,
    p_title: t.title,
    p_description: t.description || undefined,
    p_access_notes: t.accessNotes || undefined,
  });
  if (error || !data) {
    return {
      error: error?.code === "42501" ? "You can only report issues for your own properties." : (error?.message ?? "Could not send the report."),
    };
  }

  revalidatePath("/portal/owner/maintenance");
  return { id: data as string };
}
