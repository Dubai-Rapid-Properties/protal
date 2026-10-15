"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { FormError, SelectField, SubmitBar, TextAreaField, TextField } from "@/components/domain/form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INCIDENT_STATUS, optionsFrom } from "@/lib/labels";
import { shrinkPhoto } from "@/lib/shrink-photo";
import {
  addIncidentComment,
  addIncidentPhoto,
  changeIncidentStatus,
  removeIncidentPhoto,
  updateIncident,
  type ActionState,
} from "../actions";

function useToast(state: ActionState) {
  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);
}

/** Moves the incident on - in progress, waiting for payment, resolved - with an optional comment. */
export function IncidentStatus({ incidentId, status }: { incidentId: string; status: string }) {
  const [state, action] = useActionState<ActionState, FormData>(changeIncidentStatus.bind(null, incidentId), {});
  const formRef = React.useRef<HTMLFormElement>(null);
  useToast(state);
  React.useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-3">
      <FormError message={state.error} />
      <SelectField
        key={status}
        name="status"
        label="Move to"
        defaultValue={status}
        options={optionsFrom(INCIDENT_STATUS)}
      />
      <TextAreaField
        name="note"
        label="Comment (optional)"
        rows={2}
        maxLength={2000}
        placeholder="e.g. Claim sent to Airbnb, waiting for their reply."
      />
      <SubmitBar label="Update status" pendingLabel="Updating…" />
    </form>
  );
}

export interface IncidentEntry {
  id: string;
  author: string;
  when: string;
  /** e.g. "Open → In progress" */
  change: string | null;
  note: string | null;
}

function AddComment() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Adding…" : "Add comment"}
    </Button>
  );
}

/** The incident's comments and status changes, oldest first, with a box to add one. */
export function IncidentTimeline({
  incidentId,
  entries,
  canComment,
}: {
  incidentId: string;
  entries: IncidentEntry[];
  canComment: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(addIncidentComment.bind(null, incidentId), {});
  const formRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {entries.map((e) => (
          <li key={e.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted-foreground)]">
              <span className="font-medium text-[var(--foreground)]">{e.author}</span>
              <span>{e.when}</span>
            </div>
            {e.change && <p className="font-medium">{e.change}</p>}
            {e.note && <p className="whitespace-pre-line">{e.note}</p>}
          </li>
        ))}
      </ol>
      {canComment && (
        <form ref={formRef} action={action} className="space-y-2 border-t border-[var(--border)] pt-4">
          <Textarea name="note" rows={3} maxLength={2000} required placeholder="Add a comment" />
          <div className="flex justify-end">
            <AddComment />
          </div>
        </form>
      )}
    </div>
  );
}

export function IncidentOutcome({
  incidentId,
  chargeAed,
  resolution,
}: {
  incidentId: string;
  chargeAed: number | null;
  resolution: string | null;
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateIncident.bind(null, incidentId), {});
  useToast(state);

  return (
    <form action={action} className="grid gap-4">
      <FormError message={state.error} />
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
        data.set("photo", await shrinkPhoto(original));
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
