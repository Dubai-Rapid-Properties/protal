"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { TICKET_CATEGORIES } from "@/lib/labels";
import type { Enums } from "@/lib/db/database.types";

/** `id`: the ticket createTicket made; the form then sends its photos and opens it. */
export type ActionState = { error?: string; success?: string; id?: string };

const NOT_CHANGED = "This ticket could not be changed. It may be outside the properties assigned to you.";

const STATUSES = [
  "submitted", "acknowledged", "awaiting_quote", "awaiting_owner_approval", "approved",
  "scheduled", "in_progress", "on_hold", "completed", "closed", "rejected", "cancelled",
] as const satisfies readonly Enums<"maintenance_status">[];

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([z.literal("").transform(() => undefined), schema]).optional();

/** Database refusals in words staff can act on. */
function explain(error: { code?: string; message: string }): string {
  if (/requires owner approval/i.test(error.message)) {
    return "The quote is above the owner-approval limit. Set the status to Awaiting owner approval; work can go ahead once the owner approves in their portal.";
  }
  if (error.code === "42501") return NOT_CHANGED;
  return error.message;
}

const ticketSchema = z
  .object({
    unitId: z.string().uuid("Choose the unit"),
    kind: z.enum(["repair", "complaint"]),
    category: z.string(),
    priority: z.enum(["low", "medium", "high", "emergency"]),
    title: z.string().trim().min(3, "Give the ticket a short title").max(150),
    description: z.string().trim().max(4000).optional(),
    accessNotes: z.string().trim().max(1000).optional(),
    reportedBy: z.enum(["staff", "owner", "tenant", "guest"]),
  })
  .refine((t) => (TICKET_CATEGORIES[t.kind] as string[]).includes(t.category), {
    message: "Choose a category",
    path: ["category"],
  });

export async function createTicket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "maintenance.raise")) return { error: "You do not have permission to raise tickets." };

  const parsed = ticketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const t = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_requests")
    .insert({
      ticket_number: "",
      unit_id: t.unitId,
      kind: t.kind,
      category: t.category as Enums<"maintenance_category">,
      priority: t.priority,
      title: t.title,
      description: t.description || null,
      access_notes: t.accessNotes || null,
      raised_by: profile.id,
      raised_by_kind: t.reportedBy,
    })
    .select("id")
    .single();
  if (error) return { error: explain(error) };

  revalidatePath("/maintenance");
  return { id: data.id };
}

const statusSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(2000).optional(),
  internal: z.literal("on").optional(),
});

/** Moves a ticket on, stamping the matching time and logging the change. */
export async function changeTicketStatus(
  ticketId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "maintenance.assign")) return { error: "You do not have permission to update tickets." };
  if (!z.string().uuid().safeParse(ticketId).success) return { error: "Unknown ticket." };
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Choose a status." };
  const { status, note, internal } = parsed.data;

  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("status, acknowledged_at, started_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return { error: NOT_CHANGED };
  if (ticket.status === status && !note) return { error: "That is already the status." };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("maintenance_requests")
    .update({
      status,
      ...(status !== "submitted" && !ticket.acknowledged_at ? { acknowledged_at: now } : {}),
      ...(status === "in_progress" && !ticket.started_at ? { started_at: now } : {}),
      ...(status === "completed" ? { completed_at: now } : {}),
      ...(status === "closed" ? { closed_at: now } : {}),
    })
    .eq("id", ticketId)
    .select("id");
  if (error) return { error: explain(error) };
  if (!data?.length) return { error: NOT_CHANGED };

  await supabase.from("maintenance_updates").insert({
    request_id: ticketId,
    author_id: profile.id,
    note: note || null,
    status_from: ticket.status,
    status_to: status,
    is_internal: internal === "on",
  });

  revalidatePath("/maintenance");
  revalidatePath(`/maintenance/${ticketId}`);
  return { success: "Status updated." };
}

const detailsSchema = z.object({
  priority: z.enum(["low", "medium", "high", "emergency"]),
  assignedTo: optional(z.string().uuid()),
  scheduledFor: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  quotedAmount: optional(z.coerce.number().min(0)),
  finalAmount: optional(z.coerce.number().min(0)),
  costBorneBy: z.enum(["owner", "tenant", "drp", "insurance", "warranty"]),
  resolutionNotes: z.string().trim().max(2000).optional(),
});

/** Who handles it, when, what it costs and who pays. */
export async function updateTicketDetails(
  ticketId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "maintenance.assign")) return { error: "You do not have permission to update tickets." };
  if (!z.string().uuid().safeParse(ticketId).success) return { error: "Unknown ticket." };
  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_requests")
    .update({
      priority: d.priority,
      assigned_to: d.assignedTo ?? null,
      scheduled_for: d.scheduledFor ? `${d.scheduledFor}T09:00:00+04:00` : null,
      quoted_amount_aed: d.quotedAmount ?? null,
      final_amount_aed: d.finalAmount ?? null,
      cost_borne_by: d.costBorneBy,
      resolution_notes: d.resolutionNotes || null,
    })
    .eq("id", ticketId)
    .select("id, owner_approval_required, owner_approved_at");
  if (error) return { error: explain(error) };
  if (!data?.length) return { error: NOT_CHANGED };

  revalidatePath("/maintenance");
  revalidatePath(`/maintenance/${ticketId}`);
  const needsOwner = data[0].owner_approval_required && !data[0].owner_approved_at;
  return {
    success: needsOwner
      ? "Saved. The quote needs the owner's approval: set the status to Awaiting owner approval."
      : "Saved.",
  };
}

/**
 * Removes a ticket completely: its timeline and notifications go with it.
 * For tickets raised by mistake or as a test; a real job that is not going
 * ahead should be Cancelled instead, so its history stays.
 */
export async function deleteTicket(ticketId: string): Promise<ActionState> {
  const profile = await requireProfile();
  // Matches the database rule (pms.is_manager).
  if (profile.role !== "super_admin" && profile.role !== "property_manager") {
    return { error: "Only a super admin or property manager can delete a ticket." };
  }
  if (!z.string().uuid().safeParse(ticketId).success) return { error: "Ticket not found." };

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("maintenance_requests")
    .delete()
    .eq("id", ticketId)
    .select("id");
  if (error) return { error: explain(error) };
  if (!removed?.length) return { error: NOT_CHANGED };

  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
  redirect("/maintenance");
}
