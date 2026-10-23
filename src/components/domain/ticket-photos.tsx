"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { MAX_TICKET_PHOTOS } from "@/lib/tickets/photos";
import { addTicketPhoto, removeTicketPhoto } from "@/app/ticket-photo-actions";

/**
 * Sends chosen photos to a ticket one at a time, already shrunk, so each
 * request stays under the upload limit. Returns how many arrived.
 */
export async function uploadTicketPhotos(ticketId: string, files: File[]): Promise<number> {
  let added = 0;
  for (const original of files) {
    try {
      const data = new FormData();
      data.set("photo", await shrinkPhoto(original));
      const result = await addTicketPhoto(ticketId, data);
      if (result.error) toast.error(result.error);
      else added++;
    } catch {
      toast.error(`${original.name} was not uploaded.`);
    }
  }
  return added;
}

/** A ticket's photos, with Add photos (and Remove for super admins). Both portals. */
export function TicketPhotos({
  ticketId,
  photos,
  canAdd,
  canRemove,
}: {
  ticketId: string;
  photos: { path: string; url: string | null }[];
  canAdd: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const room = MAX_TICKET_PHOTOS - photos.length;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) toast.error(`A ticket holds up to ${MAX_TICKET_PHOTOS} photos.`);
    setUploading(true);
    const added = await uploadTicketPhotos(ticketId, chosen);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (added) {
      toast.success(added === 1 ? "Photo added." : `${added} photos added.`);
      router.refresh();
    }
  }

  async function remove(path: string) {
    if (!window.confirm("Remove this photo? It cannot be recovered.")) return;
    const result = await removeTicketPhoto(ticketId, path);
    if (result.error) toast.error(result.error);
    else {
      toast.success(result.success ?? "Photo removed.");
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      {photos.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.path} className="relative overflow-hidden rounded-md border border-[var(--border)]">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                  <img src={p.url} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
                </a>
              ) : (
                <div className="flex aspect-square items-center justify-center text-xs text-[var(--muted-foreground)]">
                  Could not load
                </div>
              )}
              {canRemove && (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-1.5 top-1.5 size-7"
                  aria-label="Remove photo"
                  onClick={() => remove(p.path)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && room > 0 && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <Button type="button" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {uploading ? "Uploading…" : "Add photos"}
          </Button>
        </>
      )}
    </div>
  );
}

/** Photos chosen on the new-ticket form, sent once the ticket exists. */
export function PhotoChooser({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const fileInput = React.useRef<HTMLInputElement>(null);
  const previews = React.useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  React.useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function choose(list: FileList | null) {
    if (!list?.length) return;
    const room = MAX_TICKET_PHOTOS - files.length;
    if (list.length > room) toast.error(`A ticket holds up to ${MAX_TICKET_PHOTOS} photos.`);
    onChange([...files, ...Array.from(list).slice(0, room)]);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="space-y-3">
      {files.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative overflow-hidden rounded-md border border-[var(--border)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a chosen file */}
              <img src={previews[i]} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute right-1.5 top-1.5 size-7"
                aria-label={`Remove photo ${i + 1}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => choose(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || files.length >= MAX_TICKET_PHOTOS}
        onClick={() => fileInput.current?.click()}
      >
        <ImagePlus className="size-4" />
        {files.length ? "Add more photos" : "Add photos"}
      </Button>
      <p className="text-xs text-[var(--muted-foreground)]">
        Up to {MAX_TICKET_PHOTOS} photos. On a phone you can take them with the camera.
      </p>
    </div>
  );
}
