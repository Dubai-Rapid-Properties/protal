"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { BUCKETS, storage } from "@/lib/storage";
import { dubaiToday } from "@/lib/calendar";
import { flushEmailsSoon } from "@/lib/notify/flush";
import { REFUND_PEOPLE, paymentProofPath, receiptPath, receiptProblem } from "@/lib/refunds";

export type ActionState = { error?: string; success?: string };

const NOT_CHANGED = "This claim could not be changed. Only a super admin, or whoever added it while it is waiting, can.";

const refundSchema = z.object({
  spentBy: z.enum(REFUND_PEOPLE, { message: "Choose who paid" }),
  description: z.string().trim().min(2, "Say what it was for").max(500),
  amount: z.coerce.number().positive("Enter the amount paid").max(999_999),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was paid"),
});

/**
 * Saves a new claim and returns its id; the form then sends the receipt
 * (addRefundReceipt). Super admins and finance are notified (0052), on their
 * phones too (0051).
 */
export async function createRefund(formData: FormData): Promise<ActionState & { id?: string }> {
  const profile = await requireProfile();
  if (!can(profile.role, "refunds.view")) return { error: "Only staff can claim a refund." };
  const parsed = refundSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const r = parsed.data;
  if (r.spentOn > dubaiToday()) return { error: "The date paid cannot be in the future." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("refunds")
    .insert({
      spent_by: r.spentBy,
      description: r.description,
      amount_aed: Math.round(r.amount * 100) / 100,
      spent_on: r.spentOn,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  flushEmailsSoon();
  revalidatePath("/refunds");
  return { id: data.id };
}

/** Stores the receipt (a photo, already shrunk in the browser, or a PDF). */
export async function addRefundReceipt(refundId: string, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "refunds.view")) return { error: "Only staff can add a receipt." };
  if (!z.string().uuid().safeParse(refundId).success) return { error: "Claim not found." };

  const file = formData.get("receipt");
  if (!(file instanceof File)) return { error: "Choose the receipt." };
  const problem = receiptProblem(file);
  if (problem) return { error: problem };

  const path = receiptPath(refundId, file.type);
  try {
    await storage.upload(BUCKETS.documents, path, file);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from("refunds")
    .update({ receipt_path: path })
    .eq("id", refundId)
    .select("id");
  if (error || !saved?.length) {
    // Best effort: only admins may delete files.
    await storage.remove(BUCKETS.documents, path).catch(() => undefined);
    return { error: error && error.code !== "42501" ? error.message : NOT_CHANGED };
  }

  revalidatePath("/refunds");
  return { success: "Receipt added." };
}

/**
 * Super admins: the proof a claim was paid back (a transfer screenshot, a
 * photo of the receipt, a PDF). A new one replaces the last.
 */
export async function addPaymentProof(refundId: string, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "refunds.settle")) return { error: "Only a super admin can add the payment receipt." };
  if (!z.string().uuid().safeParse(refundId).success) return { error: "Claim not found." };

  const file = formData.get("proof");
  if (!(file instanceof File)) return { error: "Choose the payment receipt." };
  const problem = receiptProblem(file);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { data: claim } = await supabase.from("refunds").select("payment_proof_path").eq("id", refundId).maybeSingle();
  if (!claim) return { error: "Claim not found." };

  const path = paymentProofPath(refundId, file.type);
  try {
    await storage.upload(BUCKETS.documents, path, file);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  const { data: saved, error } = await supabase
    .from("refunds")
    .update({ payment_proof_path: path })
    .eq("id", refundId)
    .select("id");
  if (error || !saved?.length) {
    await storage.remove(BUCKETS.documents, path).catch(() => undefined);
    return { error: error && error.code !== "42501" ? error.message : NOT_CHANGED };
  }
  if (claim.payment_proof_path) {
    await storage.remove(BUCKETS.documents, claim.payment_proof_path).catch(() => undefined);
  }

  revalidatePath("/refunds");
  return { success: "Payment receipt added." };
}

const settleSchema = z.object({
  status: z.enum(["refunded", "rejected", "pending"]),
  note: z.string().trim().max(300).optional(),
});

/** Super admins: refunded, declined, or back to waiting. The claimant hears of it. */
export async function settleRefund(refundId: string, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "refunds.settle")) return { error: "Only a super admin can settle a refund." };
  if (!z.string().uuid().safeParse(refundId).success) return { error: "Claim not found." };
  const parsed = settleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Choose refunded or declined." };
  const { status, note } = parsed.data;

  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from("refunds")
    .update(
      status === "pending"
        ? { status, settled_on: null, settled_by: null, settle_note: null }
        : { status, settled_on: dubaiToday(), settled_by: profile.id, settle_note: note || null }
    )
    .eq("id", refundId)
    .select("id");
  if (error) return { error: error.message };
  if (!saved?.length) return { error: NOT_CHANGED };

  flushEmailsSoon();
  revalidatePath("/refunds");
  return {
    success: status === "refunded" ? "Marked as refunded." : status === "rejected" ? "Claim declined." : "Back to waiting.",
  };
}

/** Super admins: removes a claim entered by mistake, with its receipt and payment receipt. */
export async function deleteRefund(refundId: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "refunds.settle")) return { error: "Only a super admin can delete a claim." };
  if (!z.string().uuid().safeParse(refundId).success) return { error: "Claim not found." };

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("refunds")
    .delete()
    .eq("id", refundId)
    .select("receipt_path, payment_proof_path");
  if (error) return { error: error.message };
  if (!removed?.length) return { error: NOT_CHANGED };
  for (const path of [removed[0].receipt_path, removed[0].payment_proof_path]) {
    if (path) await storage.remove(BUCKETS.documents, path).catch(() => undefined);
  }

  revalidatePath("/refunds");
  return { success: "Claim deleted." };
}
