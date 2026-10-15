"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { BUCKETS, storage } from "@/lib/storage";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_STATUSES,
  MAX_INCIDENT_PHOTOS,
  incidentPhotoPath,
  incidentPhotoProblem,
} from "@/lib/incidents";

export type ActionState = { error?: string; success?: string };

const NOT_CHANGED = "This incident could not be changed. It may be outside the properties assigned to you.";

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([z.literal("").transform(() => undefined), schema]).optional();

const incidentSchema = z.object({
  unitId: z.string().uuid("Choose the unit"),
  bookingId: optional(z.string().uuid()),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it happened"),
  category: z.enum(INCIDENT_CATEGORIES as [string, ...string[]], { message: "Choose what happened" }),
  description: z.string().trim().min(3, "Describe what happened").max(4000),
  chargeAed: optional(z.coerce.number().min(0, "The charge cannot be negative").max(1_000_000)),
  status: z.enum(INCIDENT_STATUSES as [string, ...string[]]).default("open"),
});

function explain(error: { code?: string; message: string }): string {
  if (error.code === "42501") return NOT_CHANGED;
  return error.message;
}

/**
 * Saves a new incident and returns its id; the form then sends the chosen
 * photos one at a time (addIncidentPhoto) and opens the incident.
 */
export async function createIncident(formData: FormData): Promise<ActionState & { id?: string }> {
  const profile = await requireProfile();
  if (!can(profile.role, "incidents.report")) return { error: "You do not have permission to report incidents." };

  const parsed = incidentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guest_incidents")
    .insert({
      unit_id: v.unitId,
      booking_id: v.bookingId ?? null,
      occurred_on: v.occurredOn,
      category: v.category,
      description: v.description,
      charge_aed: v.chargeAed ?? null,
      status: v.status,
      reported_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { error: explain(error) };

  revalidatePath("/incidents");
  if (v.bookingId) revalidatePath(`/bookings/${v.bookingId}`);
  return { id: data.id };
}

const updateSchema = z.object({
  resolution: z.string().trim().max(2000).optional(),
  chargeAed: optional(z.coerce.number().min(0, "The charge cannot be negative").max(1_000_000)),
});

/** Records the outcome: the charge and what was done. The status has its own action. */
export async function updateIncident(
  incidentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "incidents.report")) return { error: "You do not have permission to change incidents." };
  if (!z.string().uuid().safeParse(incidentId).success) return { error: "Incident not found." };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guest_incidents")
    .update({ resolution: v.resolution || null, charge_aed: v.chargeAed ?? null })
    .eq("id", incidentId)
    .select("id, booking_id");
  if (error) return { error: explain(error) };
  if (!data?.length) return { error: NOT_CHANGED };

  revalidatePath("/incidents");
  revalidatePath(`/incidents/${incidentId}`);
  if (data[0].booking_id) revalidatePath(`/bookings/${data[0].booking_id}`);
  return { success: "Saved." };
}

const statusSchema = z.object({
  status: z.enum(INCIDENT_STATUSES as [string, ...string[]], { message: "Choose a status" }),
  note: z.string().trim().max(2000, "Keep the comment under 2,000 characters").optional(),
});

/** Moves the incident to a status; the change, and any comment, go on its timeline. */
export async function changeIncidentStatus(
  incidentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "incidents.report")) return { error: "You do not have permission to change incidents." };
  if (!z.string().uuid().safeParse(incidentId).success) return { error: "Incident not found." };

  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { status, note } = parsed.data;

  const supabase = await createClient();
  const { data: incident } = await supabase
    .from("guest_incidents")
    .select("status, booking_id")
    .eq("id", incidentId)
    .maybeSingle();
  if (!incident) return { error: NOT_CHANGED };
  if (incident.status === status && !note) return { error: "That is already the status." };

  const { error } = await supabase.rpc("set_guest_incident_status", {
    p_incident_id: incidentId,
    p_status: status,
    p_note: note || undefined,
  });
  if (error) return { error: explain(error) };

  revalidatePath("/incidents");
  revalidatePath(`/incidents/${incidentId}`);
  if (incident.booking_id) revalidatePath(`/bookings/${incident.booking_id}`);
  return { success: incident.status === status ? "Comment added." : "Status updated." };
}

const commentSchema = z.object({
  note: z.string().trim().min(1, "Write a comment").max(2000, "Keep the comment under 2,000 characters"),
});

/** Adds a comment to the incident's timeline. */
export async function addIncidentComment(
  incidentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "incidents.report")) return { error: "You do not have permission to comment on incidents." };
  if (!z.string().uuid().safeParse(incidentId).success) return { error: "Incident not found." };

  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the comment." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("guest_incident_updates")
    .insert({ incident_id: incidentId, author_id: profile.id, note: parsed.data.note });
  if (error) return { error: explain(error) };

  revalidatePath(`/incidents/${incidentId}`);
  return { success: "Comment added." };
}

/**
 * Stores one photo. The browser sends them one at a time, already shrunk, so
 * each request stays under the hosting platform's upload limit.
 */
export async function addIncidentPhoto(incidentId: string, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "incidents.report")) return { error: "You do not have permission to add photos." };
  if (!z.string().uuid().safeParse(incidentId).success) return { error: "Incident not found." };

  const file = formData.get("photo");
  if (!(file instanceof File)) return { error: "Choose a photo." };
  const problem = incidentPhotoProblem(file);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { data: incident } = await supabase
    .from("guest_incidents")
    .select("id, photo_paths")
    .eq("id", incidentId)
    .maybeSingle();
  if (!incident) return { error: NOT_CHANGED };
  if (incident.photo_paths.length >= MAX_INCIDENT_PHOTOS) {
    return { error: `An incident holds up to ${MAX_INCIDENT_PHOTOS} photos.` };
  }

  const path = incidentPhotoPath(incidentId, file.name, file.type);
  try {
    await storage.upload(BUCKETS.documents, path, file);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  const { data: saved, error } = await supabase
    .from("guest_incidents")
    .update({ photo_paths: [...incident.photo_paths, path] })
    .eq("id", incidentId)
    .select("id");
  if (error || !saved?.length) {
    // Do not leave a file nothing points at; only admins may delete, so this
    // is best effort.
    await storage.remove(BUCKETS.documents, path).catch(() => undefined);
    return { error: error ? explain(error) : NOT_CHANGED };
  }

  revalidatePath(`/incidents/${incidentId}`);
  return { success: "Photo added." };
}

/** Removes a photo. Admins only, like every other file in the vault. */
export async function removeIncidentPhoto(incidentId: string, path: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") return { error: "Only a super admin can remove a photo." };
  if (!z.string().uuid().safeParse(incidentId).success) return { error: "Incident not found." };

  const supabase = await createClient();
  const { data: incident } = await supabase
    .from("guest_incidents")
    .select("photo_paths")
    .eq("id", incidentId)
    .maybeSingle();
  if (!incident?.photo_paths.includes(path)) return { error: "Photo not found." };

  const { error } = await supabase
    .from("guest_incidents")
    .update({ photo_paths: incident.photo_paths.filter((p) => p !== path) })
    .eq("id", incidentId);
  if (error) return { error: explain(error) };
  await storage.remove(BUCKETS.documents, path).catch(() => undefined);

  revalidatePath(`/incidents/${incidentId}`);
  return { success: "Photo removed." };
}
