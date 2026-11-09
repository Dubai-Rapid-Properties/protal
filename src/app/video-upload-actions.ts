"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { BUCKETS } from "@/lib/storage";
import { isVideoPath, videoPath, videoProblem } from "@/lib/media";
import { MAX_TICKET_PHOTOS } from "@/lib/tickets/photos";
import { MAX_INCIDENT_PHOTOS } from "@/lib/incidents";

/**
 * Videos on repairs, complaints and guest incidents (0067). A video is too big
 * for a request to the portal, so the browser uploads it straight to storage
 * with a one-time link from startVideoUpload, then finishVideoUpload adds it
 * to the ticket or incident beside its photos.
 */

type Kind = "ticket" | "incident";
type Start = { error: string } | { bucket: string; path: string; token: string };
type Result = { error?: string; success?: string };

const NOT_FOUND = { ticket: "Ticket not found.", incident: "Incident not found." };
const MAX = { ticket: MAX_TICKET_PHOTOS, incident: MAX_INCIDENT_PHOTOS };

/** The item, read as the signed-in person (row security decides), with its photos and videos. */
async function readItem(kind: Kind, id: string) {
  const supabase = await createClient();
  const { data } =
    kind === "ticket"
      ? await supabase.from("maintenance_requests").select("id, photo_paths").eq("id", id).maybeSingle()
      : await supabase.from("guest_incidents").select("id, photo_paths").eq("id", id).maybeSingle();
  return data ? { supabase, paths: data.photo_paths ?? [] } : null;
}

async function allowed(kind: Kind) {
  const profile = await requireProfile();
  return can(profile.role, kind === "ticket" ? "maintenance.raise" : "incidents.report");
}

/** Checks the video and the item, and gives the browser a one-time link to upload it to. */
export async function startVideoUpload(
  kind: Kind,
  id: string,
  file: { name: string; type: string; size: number }
): Promise<Start> {
  if (!(await allowed(kind))) return { error: "You do not have permission to add videos." };
  if (!z.string().uuid().safeParse(id).success) return { error: NOT_FOUND[kind] };
  const problem = videoProblem(file);
  if (problem) return { error: problem };

  const item = await readItem(kind, id);
  if (!item) return { error: NOT_FOUND[kind] };
  if (item.paths.length >= MAX[kind]) return { error: `Up to ${MAX[kind]} photos and videos.` };

  const path = videoPath(kind, id, file.name, file.type);
  const { data, error } = await createAdminClient().storage.from(BUCKETS.documents).createSignedUploadUrl(path);
  if (error || !data) return { error: "The upload could not be started. Try again." };
  return { bucket: BUCKETS.documents, path, token: data.token };
}

/** Adds an uploaded video to the ticket or incident. */
export async function finishVideoUpload(kind: Kind, id: string, path: string): Promise<Result> {
  if (!(await allowed(kind))) return { error: "You do not have permission to add videos." };
  if (!z.string().uuid().safeParse(id).success) return { error: NOT_FOUND[kind] };
  const folder = `${kind}/${id}`;
  const name = path.slice(folder.length + 1);
  if (!path.startsWith(`${folder}/`) || name.includes("/") || !isVideoPath(path)) return { error: "Not a video of this item." };

  const admin = createAdminClient();
  const { data: found } = await admin.storage.from(BUCKETS.documents).list(folder, { search: name });
  if (!found?.some((f) => f.name === name)) return { error: "The video did not arrive. Try again." };

  const item = await readItem(kind, id);
  let failed = !item;
  if (item && kind === "ticket") {
    const { error } = await item.supabase.rpc("add_ticket_photo", { p_ticket_id: id, p_path: path });
    failed = Boolean(error);
  } else if (item) {
    const { data, error } = await item.supabase
      .from("guest_incidents")
      .update({ photo_paths: [...item.paths, path] })
      .eq("id", id)
      .select("id");
    failed = Boolean(error) || !data?.length;
  }
  if (failed) {
    // Do not leave a file nothing points at.
    await admin.storage.from(BUCKETS.documents).remove([path]).catch(() => undefined);
    return { error: `The video could not be added. Up to ${MAX[kind]} photos and videos.` };
  }

  if (kind === "ticket") {
    revalidatePath(`/maintenance/${id}`);
    revalidatePath(`/portal/owner/maintenance/${id}`);
  } else revalidatePath(`/incidents/${id}`);
  return { success: "Video added." };
}
