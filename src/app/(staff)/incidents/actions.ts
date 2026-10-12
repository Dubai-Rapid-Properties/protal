"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { BUCKETS, storage } from "@/lib/storage";
import {
  INCIDENT_CATEGORIES,
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
});

function explain(error: { code?: string; message: string }): string {
  if (error.code === "42501") return NOT_CHANGED;
  return error.message;
}

export async function createIncident(_prev: ActionState, formData: FormData): Promise<ActionState> {
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
      reported_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { error: explain(error) };

  revalidatePath("/incidents");
  if (v.bookingId) revalidatePath(`/bookings/${v.bookingId}`);
  redirect(`/incidents/${data.id}`);
}

const updateSchema = z.object({
  status: z.enum(["open", "resolved"]),
  resolution: z.string().trim().max(2000).optional(),
  chargeAed: optional(z.coerce.number().min(0, "The charge cannot be negative").max(1_000_000)),
});

/** Records the outcome: the charge, what was done, open or resolved. */
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
    .update({ status: v.status, resolution: v.resolution || null, charge_aed: v.chargeAed ?? null })
    .eq("id", incidentId)
    .select("id, booking_id");
  if (error) return { error: explain(error) };
  if (!data?.length) return { error: NOT_CHANGED };

  revalidatePath("/incidents");
  revalidatePath(`/incidents/${incidentId}`);
  if (data[0].booking_id) revalidatePath(`/bookings/${data[0].booking_id}`);
  return { success: v.status === "resolved" ? "Incident resolved." : "Incident saved." };
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
