import { createClient } from "@/lib/supabase/client";
import { videoProblem } from "@/lib/media";
import { finishVideoUpload, startVideoUpload } from "@/app/video-upload-actions";

/**
 * Uploads one video straight from the browser to storage (it is too big to
 * pass through the portal), then adds it to the ticket or incident.
 * Returns an error message, or null once the video is in. Browser only.
 */
export async function uploadVideo(kind: "ticket" | "incident", id: string, file: File): Promise<string | null> {
  const problem = videoProblem(file);
  if (problem) return problem;
  const start = await startVideoUpload(kind, id, { name: file.name, type: file.type, size: file.size });
  if ("error" in start) return start.error;
  const { error } = await createClient()
    .storage.from(start.bucket)
    .uploadToSignedUrl(start.path, start.token, file, { contentType: file.type });
  if (error) return `${file.name} was not uploaded: ${error.message}`;
  const done = await finishVideoUpload(kind, id, start.path);
  return done.error ?? null;
}
