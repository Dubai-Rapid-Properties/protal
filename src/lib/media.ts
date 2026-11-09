/**
 * Videos next to the photos on repairs, complaints and guest incidents
 * (migration 0067). Pure helpers, unit-tested directly. A video is stored in
 * the same list as the photos (photo_paths) and told apart by its extension.
 */

export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** The documents bucket's limit for one file (0067); about a minute of phone video. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export const isVideoFile = (file: { type: string }) => file.type.startsWith("video/");
export const isVideoPath = (path: string) => /\.(mp4|mov|webm)$/i.test(path);

/** Why a video cannot be stored, or null when it can. */
export function videoProblem(file: { name: string; type: string; size: number }): string | null {
  if (!VIDEO_TYPES[file.type]) return `${file.name}: use an MP4, MOV or WebM video.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_VIDEO_BYTES) return `${file.name} is larger than 50 MB. Record a shorter clip (about a minute).`;
  return null;
}

/** Where a ticket's or incident's video lives in the documents bucket, next to its photos. */
export function videoPath(kind: "ticket" | "incident", id: string, fileName: string, type: string, now = Date.now()): string {
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "video";
  return `${kind}/${id}/${now}-${base}.${VIDEO_TYPES[type] ?? "mp4"}`;
}
