"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { FormError, SelectField, SubmitBar, TextAreaField, TextField } from "@/components/domain/form";
import { Button } from "@/components/ui/button";
import { INCIDENT_STATUS, optionsFrom } from "@/lib/labels";
import { addIncidentPhoto, removeIncidentPhoto, updateIncident, type ActionState } from "../actions";

export function IncidentOutcome({
  incidentId,
  status,
  chargeAed,
  resolution,
}: {
  incidentId: string;
  status: string;
  chargeAed: number | null;
  resolution: string | null;
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateIncident.bind(null, incidentId), {});
  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);

  return (
    <form action={action} className="grid gap-4">
      <FormError message={state.error} />
      <SelectField name="status" label="Status" defaultValue={status} options={optionsFrom(INCIDENT_STATUS)} />
      <TextField
        name="chargeAed"
        label="Charge to the guest (AED)"
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        defaultValue={chargeAed ?? ""}
      />
      <TextAreaField
        name="resolution"
        label="What was done"
        rows={3}
        defaultValue={resolution ?? ""}
        placeholder="e.g. Deep clean done; AED 350 claimed through Airbnb."
      />
      <SubmitBar label="Save" pendingLabel="Saving…" />
    </form>
  );
}

/**
 * Phone photos are often 3-8 MB, over the hosting platform's upload limit, so
 * each is redrawn at most 2000 px wide as a JPEG first. A photo the browser
 * cannot decode (HEIC outside Safari) is sent as it is.
 */
async function shrink(file: File): Promise<File> {
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

export function IncidentPhotos({
  incidentId,
  photos,
  canAdd,
  canRemove,
}: {
  incidentId: string;
  photos: { path: string; url: string | null }[];
  canAdd: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(0);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    setUploading(chosen.length);
    let added = 0;
    // One at a time: each request stays under the upload size limit.
    for (const original of chosen) {
      try {
        const data = new FormData();
        data.set("photo", await shrink(original));
        const result = await addIncidentPhoto(incidentId, data);
        if (result.error) toast.error(result.error);
        else added++;
      } catch {
        toast.error(`${original.name} was not uploaded.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
    if (added) {
      toast.success(added === 1 ? "Photo added." : `${added} photos added.`);
      router.refresh();
    }
  }

  async function remove(path: string) {
    if (!window.confirm("Remove this photo? It cannot be recovered.")) return;
    const result = await removeIncidentPhoto(incidentId, path);
    if (result.error) toast.error(result.error);
    else {
      toast.success(result.success ?? "Photo removed.");
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      {photos.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No photos yet. Photos of the mess or damage help with Airbnb claims and deposit deductions.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.path} className="relative overflow-hidden rounded-md border border-[var(--border)]">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                  <img src={p.url} alt={`Incident photo ${i + 1}`} className="aspect-square w-full object-cover" />
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
      {canAdd && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <Button type="button" variant="outline" disabled={uploading > 0} onClick={() => fileInput.current?.click()}>
            {uploading > 0 ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {uploading > 0 ? `Uploading ${uploading}…` : "Add photos"}
          </Button>
        </>
      )}
    </div>
  );
}
