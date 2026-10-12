/**
 * Phone photos are often 3-8 MB, over the hosting platform's upload limit, so
 * each is redrawn at most 2000 px wide as a JPEG before it is sent. A photo
 * the browser cannot decode (HEIC outside Safari) is returned as it is.
 * Browser only.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1_000_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
