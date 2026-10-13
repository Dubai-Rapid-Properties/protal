"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { LEAD_INTENTS, LEAD_STAGES, type LeadIntent, type LeadStage } from "@/lib/leads";

export type ActionState = { error?: string; success?: string };

const NOT_ALLOWED = "You do not have permission to update leads.";

const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([z.literal("").transform(() => undefined), schema]).optional();

const leadSchema = z.object({
  stage: z.enum(Object.keys(LEAD_STAGES) as [LeadStage, ...LeadStage[]]),
  intent: z.enum(Object.keys(LEAD_INTENTS) as [LeadIntent, ...LeadIntent[]]),
  assignedTo: blank(z.string().uuid()),
  followUp: blank(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the follow-up date")),
  lostReason: z.string().trim().max(500).optional(),
  notes: z.string().max(5000).optional(),
  note: z.string().trim().max(2000).optional(),
});

/** Stage, owner, follow-up and notes; a stage change or a note goes on the timeline. */
export async function updateLead(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "leads.manage")) return { error: NOT_ALLOWED };
  if (!z.string().uuid().safeParse(leadId).success) return { error: "Lead not found." };
  const parsed = leadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  if (v.stage === "lost" && !v.lostReason) return { error: "Say why the lead was lost." };

  const supabase = await createClient();
  const { data: before } = await supabase.from("leads").select("stage").eq("id", leadId).maybeSingle();
  if (!before) return { error: "Lead not found." };

  const { data: changed, error } = await supabase
    .from("leads")
    .update({
      stage: v.stage,
      intent: v.intent,
      assigned_to: v.assignedTo ?? null,
      next_follow_up_at: v.followUp ? `${v.followUp}T09:00:00+04:00` : null,
      lost_reason: v.stage === "lost" ? v.lostReason || null : null,
      notes: v.notes?.replace(/\r\n/g, "\n").trim() || null,
    })
    .eq("id", leadId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_ALLOWED };

  if (before.stage !== v.stage || v.note) {
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      author_id: profile.id,
      kind: "note",
      body: v.note || null,
      stage_from: before.stage !== v.stage ? before.stage : null,
      stage_to: before.stage !== v.stage ? v.stage : null,
    });
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return { success: "Saved." };
}

/** Removes a lead and its timeline for good, e.g. a test or spam enquiry. */
export async function deleteLead(leadId: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "leads.manage")) return { error: "You do not have permission to delete leads." };
  if (!z.string().uuid().safeParse(leadId).success) return { error: "Lead not found." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").delete().eq("id", leadId).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "This lead could not be deleted." };

  revalidatePath("/leads");
  redirect("/leads?deleted=1");
}
