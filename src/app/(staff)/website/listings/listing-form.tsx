"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Link2, Loader2, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  FormError,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/domain/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COMPLETIONS,
  FURNISHINGS,
  LISTING_STATUSES,
  PROPERTY_TYPES,
  defaultMapQuery,
  imagesOf,
  slugify,
  type ListingRow,
} from "@/lib/listings";
import { deleteListing, saveListing, uploadListingPhoto, type ListingState } from "./actions";

const options = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

export function ListingForm({
  listing,
  areas,
  units,
  agents,
  today,
}: {
  listing?: ListingRow;
  areas: string[];
  units: { id: string; label: string }[];
  agents: string[];
  today: string;
}) {
  const [state, action] = useActionState<ListingState, FormData>(saveListing.bind(null, listing?.id ?? null), {});
  const [title, setTitle] = React.useState(listing?.title ?? "");
  // The web address follows the title until someone types their own.
  const [slug, setSlug] = React.useState<string | null>(listing ? listing.slug : null);
  const [building, setBuilding] = React.useState(listing?.building ?? "");
  const [area, setArea] = React.useState(listing?.area ?? "");
  const [images, setImages] = React.useState<string[]>(listing ? imagesOf(listing) : []);
  const [uploading, setUploading] = React.useState(0);
  const [link, setLink] = React.useState("");
  const [deleting, startDelete] = React.useTransition();
  const [saving, startSaving] = React.useTransition();
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const slugValue = slug ?? slugify(title);
  const wasLive = listing?.status === "published";

  const move = (from: number, to: number) =>
    setImages((list) => {
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    setUploading((n) => n + chosen.length);
    // One at a time: each request stays well under the upload size limit.
    for (const file of chosen) {
      const data = new FormData();
      data.set("photo", file);
      try {
        const result = await uploadListingPhoto(data);
        if (result.url) setImages((list) => [...list, result.url!]);
        else toast.error(result.error ?? `${file.name} was not uploaded.`);
      } catch {
        toast.error(`${file.name} was not uploaded.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function addLink() {
    const url = link.trim();
    if (!/^https:\/\/\S+$/.test(url)) {
      toast.error("Paste a full photo address starting with https://");
      return;
    }
    setImages((list) => (list.includes(url) ? list : [...list, url]));
    setLink("");
  }

  return (
    <form
      action={action}
      // Submitted by hand so a refused save keeps everything typed: a form
      // action resets the form's fields once it returns, even with an error.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startSaving(() => action(data));
      }}
      className="space-y-5"
    >
      <FormError message={state.error} />
      <input type="hidden" name="images" value={JSON.stringify(images)} />

      <FormSection title="Listing">
        <TextField
          name="title"
          label="Title"
          required
          wide
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="2 BR Apartment for Rent in Marina Gate 1"
        />
        <TextField
          name="slug"
          label="Web address"
          wide
          value={slugValue}
          onChange={(e) => setSlug(e.target.value)}
          hint={
            <>
              dubairapidproperties.com/properties/<strong>{slugify(slugValue) || "…"}</strong>
              {wasLive && listing && slugify(slugValue) !== listing.slug
                ? " - changing it breaks links already shared to the old address."
                : ""}
            </>
          }
        />
        <SelectField
          name="status"
          label="Status"
          required
          defaultValue={listing?.status ?? "draft"}
          options={Object.entries(LISTING_STATUSES).map(([value, label]) => ({ value, label }))}
          hint="Draft and Hidden are kept here only. On the website needs at least one photo."
        />
        <SelectField
          name="offering"
          label="For"
          required
          defaultValue={listing?.offering ?? "buy"}
          options={[
            { value: "buy", label: "Sale" },
            { value: "rent", label: "Rent" },
          ]}
        />
        <TextField
          name="price"
          label="Price (AED)"
          type="number"
          min="1"
          step="1"
          required
          defaultValue={listing ? String(Number(listing.price_aed)) : ""}
          hint="For a rental, the rent for a year."
        />
        <SelectField
          name="propertyType"
          label="Type"
          required
          defaultValue={listing?.property_type ?? "Apartment"}
          options={options(PROPERTY_TYPES)}
        />
        <SelectField
          name="completion"
          label="Completion"
          required
          defaultValue={listing?.completion ?? "Ready"}
          options={options(COMPLETIONS)}
        />
        <SelectField
          name="furnishing"
          label="Furnishing"
          defaultValue={listing?.furnishing ?? ""}
          placeholder="Not stated"
          options={options(FURNISHINGS)}
        />
      </FormSection>

      <FormSection title="Size">
        <TextField
          name="beds"
          label="Bedrooms"
          type="number"
          min="0"
          max="20"
          required
          defaultValue={String(listing?.beds ?? 1)}
          hint="0 for a studio"
        />
        <TextField name="baths" label="Bathrooms" type="number" min="0" max="20" required defaultValue={String(listing?.baths ?? 1)} />
        <TextField
          name="size"
          label="Size (sq ft)"
          type="number"
          min="1"
          step="1"
          required
          defaultValue={listing ? String(listing.size_sqft) : ""}
        />
      </FormSection>

      <FormSection title="Location">
        <TextField
          name="area"
          label="Area"
          required
          list="listing-areas"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Dubai Marina"
          hint="As the website names it, so the area guide lists it."
        />
        <datalist id="listing-areas">
          {areas.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <TextField
          name="building"
          label="Building or cluster"
          value={building}
          onChange={(e) => setBuilding(e.target.value)}
          placeholder="Marina Gate 1"
        />
        <TextField
          name="mapQuery"
          label="Map search"
          wide
          defaultValue={listing?.map_query ?? ""}
          placeholder={defaultMapQuery(building || null, area || "Area")}
          hint="What the map on the listing page looks up. Leave empty to use the building and area."
        />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="mapExact" defaultChecked={listing?.map_exact ?? false} className="size-4" />
          The map finds the building itself (not just the community)
        </label>
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
                    {i === 0 && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        Cover
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between px-1 py-1">
                    <div className="flex">
                      <Button type="button" variant="ghost" size="icon" aria-label="Move left" disabled={i === 0} onClick={() => move(i, i - 1)}>
                        <ArrowLeft className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move right"
                        disabled={i === images.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        <ArrowRight className="size-4" />
                      </Button>
                      {i > 0 && (
                        <Button type="button" variant="ghost" size="icon" aria-label="Make cover" onClick={() => move(i, 0)}>
                          <Star className="size-4" />
                        </Button>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove photo"
                      onClick={() => setImages((list) => list.filter((x) => x !== src))}
                    >
                      <X className="size-4 text-[var(--destructive)]" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
            <Button type="button" variant="outline" disabled={uploading > 0} onClick={() => fileInput.current?.click()}>
              {uploading > 0 ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {uploading > 0 ? `Uploading ${uploading}…` : "Upload photos"}
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Label htmlFor="photo-link" className="sr-only">
                Photo address
              </Label>
              <Input
                id="photo-link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                  }
                }}
                placeholder="…or paste a photo address (https://…)"
                className="min-w-0"
              />
              <Button type="button" variant="outline" onClick={addLink}>
                <Link2 className="size-4" />
                Add
              </Button>
            </div>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            JPG, PNG, WebP or AVIF, up to 10 MB each. Use the arrows to change the order; the first photo is the cover.
          </p>
        </div>
      </FormSection>

      <FormSection title="Description" columns={1}>
        <TextAreaField
          name="description"
          label="Description"
          rows={8}
          defaultValue={listing?.description ?? ""}
          hint="Leave an empty line between paragraphs."
        />
        <TextAreaField
          name="features"
          label="Features"
          rows={5}
          defaultValue={(listing?.features ?? []).join("\n")}
          hint="One per line, e.g. Balcony, Central A/C, Shared pool."
        />
      </FormSection>

      <FormSection title="Agent and references">
        <TextField
          name="agent"
          label="Agent"
          list="listing-agents"
          defaultValue={listing?.agent ?? ""}
          hint="Pick someone from Website → Team: the listing shows their photo, BRN and Call / WhatsApp."
        />
        <datalist id="listing-agents">
          {agents.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <TextField name="listedAt" label="Listed on" type="date" required defaultValue={listing?.listed_at ?? today} />
        <TextField name="permit" label="DLD advertising permit" defaultValue={listing?.permit ?? ""} />
        <TextField name="ref" label="Property Finder reference" defaultValue={listing?.ref ?? ""} />
        <TextField
          name="sourceUrl"
          label="Property Finder link"
          type="url"
          wide
          defaultValue={listing?.source_url ?? ""}
          placeholder="https://www.propertyfinder.ae/…"
        />
        <SelectField
          name="unitId"
          label="Unit in the portal"
          defaultValue={listing?.unit_id ?? ""}
          placeholder="Not a unit D|R|P manages"
          options={units.map((u) => ({ value: u.id, label: u.label }))}
          hint="Optional: link it when the listing is one of the units in this portal."
        />
      </FormSection>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {listing ? (
          <Button
            type="button"
            variant="ghost"
            disabled={deleting}
            className="text-[var(--destructive)]"
            onClick={() => {
              if (!window.confirm(`Delete "${listing.title}"? ${wasLive ? "It comes off the website. " : ""}This cannot be undone.`)) return;
              startDelete(async () => {
                const result = await deleteListing(listing.id);
                if (result?.error) toast.error(result.error);
              });
            }}
          >
            <Trash2 className="size-4" />
            Delete listing
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" asChild>
            <Link href="/website/listings">Cancel</Link>
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Saving…" : listing ? "Save listing" : "Create listing"}
          </Button>
        </div>
      </div>
    </form>
  );
}
