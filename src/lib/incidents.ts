import { INCIDENT_CATEGORY, type IncidentCategory } from "@/lib/labels";

/**
 * Guest incidents (migration 0033): what a guest did to a unit. Staff only -
 * the table's policies and the private bucket keep them from owners. Pure
 * helpers here so they are unit-tested directly.
 */

export const INCIDENT_CATEGORIES = Object.keys(INCIDENT_CATEGORY) as IncidentCategory[];

/** Photos arrive already shrunk in the browser; this is the hard ceiling. */
export const MAX_INCIDENT_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_INCIDENT_PHOTOS = 12;

const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Why a photo cannot be stored, or null when it can. */
export function incidentPhotoProblem(file: { name: string; type: string; size: number }): string | null {
  if (!PHOTO_EXTENSIONS[file.type]) return `${file.name}: use a JPG, PNG, WebP or HEIC photo.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_INCIDENT_PHOTO_BYTES) return `${file.name} is larger than 4 MB.`;
  return null;
}

/**
 * Where an incident's photo lives in the private documents bucket. No
 * documents row points at it, so only staff can read it (0011's bucket policy).
 */
export function incidentPhotoPath(incidentId: string, fileName: string, type: string, now = Date.now()): string {
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "photo";
  return `incident/${incidentId}/${now}-${base}.${PHOTO_EXTENSIONS[type] ?? "jpg"}`;
}
