"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { FormError, FormSection, SelectField, TextAreaField, TextField } from "@/components/domain/form";
import { Button } from "@/components/ui/button";
import { INCIDENT_CATEGORY, optionsFrom } from "@/lib/labels";
import { MAX_INCIDENT_PHOTOS } from "@/lib/incidents";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { addIncidentPhoto, createIncident } from "../actions";

export interface BookingOption {
  id: string;
  unitId: string;
  label: string;
}

interface Chosen {
  key: string;
  file: File;
  preview: string;
}

export function IncidentForm({
  units,
  bookings,
  defaultUnitId,
  defaultBookingId,
  today,
}: {
  units: { id: string; label: string }[];
  bookings: BookingOption[];
  defaultUnitId?: string;
  defaultBookingId?: string;
  today: string;
}) {
  const router = useRouter();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [unitId, setUnitId] = React.useState(
    units.some((u) => u.id === defaultUnitId) ? defaultUnitId! : ""
  );
  const [photos, setPhotos] = React.useState<Chosen[]>([]);
  const [error, setError] = React.useState<string>();
  const [step, setStep] = React.useState<string | null>(null);
  const unitBookings = bookings.filter((b) => b.unitId === unitId);

  // Release the thumbnails' memory when the form goes away.
  const photosRef = React.useRef(photos);
  photosRef.current = photos;
  React.useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  function choose(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_INCIDENT_PHOTOS - photos.length;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) toast.error(`An incident holds up to ${MAX_INCIDENT_PHOTOS} photos.`);
    setPhotos((list) => [
      ...list,
      ...picked.map((file) => ({
        key: `${file.name}-${file.size}-${Math.random()}`,
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
    if (fileInput.current) fileInput.current.value = "";
  }

  function drop(key: string) {
    setPhotos((list) => {
      const gone = list.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return list.filter((p) => p.key !== key);
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    setStep("Saving…");
    try {
      const saved = await createIncident(new FormData(e.currentTarget));
      if (!saved.id) {
        setError(saved.error ?? "The incident was not saved.");
        setStep(null);
        return;
      }

      // One at a time: each request stays under the upload size limit.
      let failed = 0;
      for (const [i, p] of photos.entries()) {
        setStep(`Uploading photo ${i + 1} of ${photos.length}…`);
        try {
          const data = new FormData();
          data.set("photo", await shrinkPhoto(p.file));
          const result = await addIncidentPhoto(saved.id, data);
          if (result.error) {
            failed++;
            toast.error(result.error);
          }
        } catch {
          failed++;
          toast.error(`${p.file.name} was not uploaded.`);
        }
      }

      if (failed) toast.warning("Incident saved. Add the missing photos on its page.");
      else toast.success("Incident saved.");
      router.push(`/incidents/${saved.id}`);
    } catch {
      setError("The incident was not saved. Check your connection and try again.");
      setStep(null);
    }
  }

  const busy = step !== null;

  return (
    <form onSubmit={submit} className="space-y-5">
      <FormError message={error} />
      <FormSection title="Where and who">
        <SelectField
          name="unitId"
          label="Unit"
          required
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          placeholder="Choose the unit"
          options={units.map((u) => ({ value: u.id, label: u.label }))}
        />
        <SelectField
          key={unitId}
          name="bookingId"
          label="Guest stay"
          defaultValue={unitBookings.some((b) => b.id === defaultBookingId) ? defaultBookingId : ""}
          placeholder={unitId ? (unitBookings.length ? "Not linked to a stay" : "No recent stays on this unit") : "Choose the unit first"}
          options={unitBookings.map((b) => ({ value: b.id, label: b.label }))}
          disabled={!unitId || unitBookings.length === 0}
          hint="Stays from the last 60 days."
        />
      </FormSection>
      <FormSection title="What happened">
        <SelectField
          name="category"
          label="Type"
          required
          defaultValue=""
          placeholder="Choose what happened"
          options={optionsFrom(INCIDENT_CATEGORY)}
        />
        <TextField name="occurredOn" label="Date found" type="date" required defaultValue={today} max={today} />
        <TextAreaField
          name="description"
          label="Description"
          required
          rows={4}
          placeholder="e.g. Guest was sick on the bedroom carpet; deep clean needed."
        />
        <TextField
          name="chargeAed"
          label="Charge to the guest (AED)"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          hint="Cleaning or repair cost to recover from the guest or their deposit, if any."
        />
      </FormSection>
      <FormSection
        title="Photos"
        description="Photos of the mess or damage help with Airbnb claims and deposit deductions."
        columns={1}
      >
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((p, i) => (
              <li key={p.key} className="relative overflow-hidden rounded-md border border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a chosen file */}
                <img src={p.preview} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-1.5 top-1.5 size-7"
                  aria-label={`Remove photo ${i + 1}`}
                  disabled={busy}
                  onClick={() => drop(p.key)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div>
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
            disabled={busy || photos.length >= MAX_INCIDENT_PHOTOS}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="size-4" />
            {photos.length ? "Add more photos" : "Add photos"}
          </Button>
          <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
            Up to {MAX_INCIDENT_PHOTOS} photos. On a phone you can take them with the camera.
          </p>
        </div>
      </FormSection>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" asChild>
          <Link href="/incidents">Cancel</Link>
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {step ?? "Save incident"}
        </Button>
      </div>
    </form>
  );
}
