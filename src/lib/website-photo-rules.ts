/** Photos the website shows: what the public bucket (migration 0028) accepts. Safe in the browser. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};
