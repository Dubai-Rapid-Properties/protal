"use client";

import { createClient } from "@/lib/supabase/client";
import { PHOTO_BUCKET, slugify } from "@/lib/listings";
import { MAX_PHOTO_BYTES, PHOTO_EXTENSIONS } from "@/lib/website-photo-rules";

/**
 * Uploads a website photo from the browser straight to Supabase Storage. Sent through the portal's
 * own server instead, the photo passes Cloudflare's firewall, which blocks some photos as attacks.
 * The bucket's policy still decides who may upload (listing editors), and the bucket itself limits
 * the size and type.
 */
export async function uploadWebsitePhoto(file: File, name = file.name): Promise<{ url?: string; error?: string }> {
  const ext = PHOTO_EXTENSIONS[file.type];
  if (!ext) return { error: `${file.name}: use JPG, PNG, WebP or AVIF.` };
  if (file.size > MAX_PHOTO_BYTES) return { error: `${file.name} is larger than 10 MB.` };

  const base = slugify(name.replace(/\.[^.]+$/, "")).slice(0, 40) || "photo";
  const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  const path = `${new Date().toISOString().slice(0, 7)}/${random}-${base}.${ext}`;

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (error) {
    if (/row-level security|unauthorized/i.test(error.message))
      return { error: "You do not have permission to upload website photos." };
    return { error: `${file.name} was not uploaded: ${error.message}` };
  }
  return { url: supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl };
}
