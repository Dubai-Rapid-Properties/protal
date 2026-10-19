import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { PHOTO_BUCKET, slugify } from "@/lib/listings";

import { PHOTO_EXTENSIONS } from "@/lib/website-photo-rules";

export { MAX_PHOTO_BYTES, PHOTO_EXTENSIONS } from "@/lib/website-photo-rules";

/**
 * Stores one photo in the portal's public bucket and returns its address.
 * Runs as the signed-in user, so the bucket's policy decides who may upload.
 */
export async function storeWebsitePhoto(
  supabase: SupabaseClient<Database>,
  body: Blob | Uint8Array,
  contentType: string,
  name: string
): Promise<{ url?: string; error?: string }> {
  const ext = PHOTO_EXTENSIONS[contentType];
  if (!ext) return { error: `${name}: use JPG, PNG, WebP or AVIF.` };
  const base = slugify(name.replace(/\.[^.]+$/, "")).slice(0, 40) || "photo";
  const path = `${new Date().toISOString().slice(0, 7)}/${randomBytes(6).toString("hex")}-${base}.${ext}`;
  try {
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, body, { contentType, cacheControl: "31536000", upsert: false });
    if (error) return { error: `Upload failed: ${error.message}` };
    return { url: supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl };
  } catch (err) {
    // Answer with the reason rather than failing the whole request, so staff see it.
    console.error(`[photos] upload of ${name} failed:`, err);
    return { error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
