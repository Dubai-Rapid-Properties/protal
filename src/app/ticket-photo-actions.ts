"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { BUCKETS, storage } from "@/lib/storage";
import { ticketPhotoPath, ticketPhotoProblem } from "@/lib/tickets/photos";

type Result = { error?: string; success?: string };

const NOT_ADDED = "The photo could not be added to this ticket.";

/**
 * Adds one photo to a repair or complaint (0053): staff who may raise
 * tickets, and owners on their own properties. The browser sends photos one
 * at a time, already shrunk, so each request stays under the upload limit.
 */
export async function addTicketPhoto(ticketId: string, formData: FormData): Promise<Result> {
  const profile = await requireProfile();
  if (!can(profile.role, "maintenance.raise")) return { error: "You do not have permission to add photos." };
  if (!z.string().uuid().safeParse(ticketId).success) return { error: "Ticket not found." };

  const file = formData.get("photo");
  if (!(file instanceof File)) return { error: "Choose a photo." };
  const problem = ticketPhotoProblem(file);
  if (problem) return { error: problem };

  const path = ticketPhotoPath(ticketId, file.name, file.type);
  try {
    await storage.upload(BUCKETS.documents, path, file);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_ticket_photo", { p_ticket_id: ticketId, p_path: path });
  if (error) {
    // Best effort: only admins may delete files.
    await storage.remove(BUCKETS.documents, path).catch(() => undefined);
    return { error: error.code === "23514" ? "A ticket holds up to 12 photos." : NOT_ADDED };
  }

  revalidatePath(`/maintenance/${ticketId}`);
  revalidatePath(`/portal/owner/maintenance/${ticketId}`);
  return { success: "Photo added." };
}

/** Removes a photo. Super admins only, like every other file in the vault. */
export async function removeTicketPhoto(ticketId: string, path: string): Promise<Result> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") return { error: "Only a super admin can remove a photo." };
  if (!z.string().uuid().safeParse(ticketId).success) return { error: "Ticket not found." };

  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("photo_paths")
    .eq("id", ticketId)
    .maybeSingle();
  const photos = ticket?.photo_paths ?? [];
  if (!photos.includes(path)) return { error: "Photo not found." };

  const { error } = await supabase
    .from("maintenance_requests")
    .update({ photo_paths: photos.filter((p) => p !== path) })
    .eq("id", ticketId);
  if (error) return { error: error.message };
  await storage.remove(BUCKETS.documents, path).catch(() => undefined);

  revalidatePath(`/maintenance/${ticketId}`);
  revalidatePath(`/portal/owner/maintenance/${ticketId}`);
  return { success: "Photo removed." };
}
