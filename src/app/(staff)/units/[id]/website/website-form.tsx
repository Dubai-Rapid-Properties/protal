"use client";

import * as React from "react";
import { useActionState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Link2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { FormError, FormSection, SelectField, TextAreaField, TextField } from "@/components/domain/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { uploadWebsitePhoto } from "@/lib/website-photos-client";
import { uploadErrorMessage } from "@/lib/upload-error";
import { WEBSITE_AMENITIES, WEBSITE_AREAS, WEBSITE_TYPES } from "@/lib/website-options";
import { saveUnitWebsite, type WebsiteState } from "./actions";

export interface WebsiteDefaults {
  published: boolean; title: string; slug: string; type: string; area: string; building: string; tag: string;
  description: string; highlights: string; houseRules: string; amenities: string[]; images: string[];
  lat: string; lng: string; mapsUrl: string; checkIn: string; checkOut: string; seasons: string;
  /** Sleeping arrangements as text; null when the database doesn't have the column yet (migration 0030). */
  beds: string | null;
}

export function WebsiteForm({ unitId, d }: { unitId: string; d: WebsiteDefaults }) {
  const [state, action] = useActionState<WebsiteState, FormData>(saveUnitWebsite.bind(null, unitId), {});
  const [images, setImages] = React.useState(d.images);
  const [uploading, setUploading] = React.useState(0);
  const [link, setLink] = React.useState("");
  const [saving, startSaving] = React.useTransition();
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);

  const move = (from: number, to: number) =>
    setImages((list) => {
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    setUploading((n) => n + chosen.length);
    for (const file of chosen) {
      try {
        const r = await uploadWebsitePhoto(await shrinkPhoto(file));
        if (r.url) setImages((list) => [...list, r.url!]);
        else toast.error(r.error ?? `${file.name} was not uploaded.`);
      } catch (err) {
        toast.error(uploadErrorMessage(file.name, err));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function addLink() {
    const url = link.trim();
    if (!/^https:\/\/\S+$/.test(url)) return toast.error("Paste a full photo address starting with https://");
    setImages((list) => (list.includes(url) ? list : [...list, url]));
    setLink("");
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startSaving(() => action(data));
      }}
      className="space-y-5"
    >
      <FormError message={state.error} />
      <input type="hidden" name="images" value={JSON.stringify(images)} />

      <FormSection title="On the website">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="published" defaultChecked={d.published} className="size-4" />
          <span>
            <strong>Published</strong> — show this home on the Holiday Homes website and take bookings. Nightly rate,
            guests and cleaning fee come from the unit&apos;s own details.
          </span>
        </label>
        <TextField name="title" label="Title" defaultValue={d.title} placeholder="Marina Gate 1 · 2 BR Marina View" />
        <TextField name="slug" label="Web address" defaultValue={d.slug} hint="Lowercase words with dashes. Empty = made from the title." />
        <SelectField name="type" label="Type" defaultValue={d.type} placeholder="Choose" options={WEBSITE_TYPES.map((t) => ({ value: t, label: t }))} />
        <SelectField name="area" label="Area" defaultValue={d.area} placeholder="Choose" options={WEBSITE_AREAS.map((a) => ({ value: a, label: a }))} />
        <TextField name="building" label="Building" defaultValue={d.building} />
        <TextField name="tag" label="Tag" defaultValue={d.tag} placeholder="Marina view" hint="Short label on the card." />
        <TextField name="checkIn" label="Check-in time" defaultValue={d.checkIn} />
        <TextField name="checkOut" label="Check-out time" defaultValue={d.checkOut} />
      </FormSection>

      <FormSection title="Photos" columns={1}>
        <div className="space-y-3">
          {images.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No photos yet. The first photo is the cover.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {images.map((src, i) => (
                <li key={src} className="overflow-hidden rounded-md border border-[var(--border)]">
                  <div className="relative aspect-[4/3] bg-[var(--muted)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Photo ${i + 1}`} className="size-full object-cover" loading="lazy" />
                    {i === 0 && <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">Cover</span>}
                  </div>
                  <div className="flex items-center justify-between px-1 py-1">
                    <div className="flex">
                      <Button type="button" variant="ghost" size="icon" aria-label="Move left" disabled={i === 0} onClick={() => move(i, i - 1)}>
                        <ArrowLeft className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label="Move right" disabled={i === images.length - 1} onClick={() => move(i, i + 1)}>
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove photo" onClick={() => setImages((l) => l.filter((x) => x !== src))}>
                      <X className="size-4 text-[var(--destructive)]" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
            <Button type="button" variant="outline" disabled={uploading > 0} onClick={() => fileInput.current?.click()}>
              {uploading > 0 ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {uploading > 0 ? `Uploading ${uploading}…` : "Upload photos"}
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Input
                aria-label="Photo address"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                  }
                }}
                placeholder="…or paste a photo address (https://…)"
              />
              <Button type="button" variant="outline" onClick={addLink}>
                <Link2 className="size-4" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </FormSection>

      <FormSection title="Description" columns={1}>
        <TextAreaField name="description" label="Description" rows={7} defaultValue={d.description} hint="Empty line between paragraphs." />
        <TextAreaField name="highlights" label="Highlights" rows={4} defaultValue={d.highlights} hint="One per line." />
        <TextAreaField name="houseRules" label="House rules" rows={4} defaultValue={d.houseRules} hint="One per line." />
      </FormSection>

      <FormSection title="Amenities">
        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
          {Object.entries(WEBSITE_AMENITIES).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="amenities" value={id} defaultChecked={d.amenities.includes(id)} className="size-4" />
              {label}
            </label>
          ))}
        </div>
      </FormSection>

      <FormSection title="Location">
        <TextField name="lat" label="Latitude" defaultValue={d.lat} placeholder="25.0805" />
        <TextField name="lng" label="Longitude" defaultValue={d.lng} placeholder="55.1403" />
        <TextField name="mapsUrl" label="Google Maps link" wide defaultValue={d.mapsUrl} placeholder="https://maps.app.goo.gl/…" />
      </FormSection>

      {d.beds !== null ? (
        <FormSection title="Where guests sleep" columns={1}>
          <input type="hidden" name="bedsField" value="1" />
          <TextAreaField
            name="beds"
            label="Rooms and beds"
            rows={4}
            defaultValue={d.beds}
            hint='One room per line: Room | beds, e.g. "Bedroom 1 | 1 king bed" or "Living room | 1 sofa bed". Shown on the website as "Where you will sleep".'
          />
        </FormSection>
      ) : null}

      <FormSection title="Seasonal rates" columns={1}>
        <TextAreaField
          name="seasons"
          label="Seasons"
          rows={4}
          defaultValue={d.seasons}
          hint='One per line: Name | from | to | nightly rate (AED), e.g. "New Year | 2026-12-26 | 2027-01-03 | 2400".'
        />
      </FormSection>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save website details"}</Button>
      </div>
    </form>
  );
}
