/**
 * Photos on repairs and complaints (migration 0053). Pure helpers, so they
 * are unit-tested directly; the same file rules as incident photos.
 */
export { incidentPhotoProblem as ticketPhotoProblem, MAX_INCIDENT_PHOTO_BYTES as MAX_TICKET_PHOTO_BYTES } from "@/lib/incidents";

export const MAX_TICKET_PHOTOS = 12;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/**
 * Where a ticket's photo lives in the private documents bucket:
 * ticket/<ticket id>/<time>-<name>.<ext>. add_ticket_photo() accepts only
 * paths in the ticket's own folder.
 */
export function ticketPhotoPath(ticketId: string, fileName: string, type: string, now = Date.now()): string {
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "photo";
  return `ticket/${ticketId}/${now}-${base}.${EXTENSIONS[type] ?? "jpg"}`;
}
