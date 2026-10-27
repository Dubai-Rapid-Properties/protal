"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardPaste, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/domain/shared";
import { FormError, FormSection } from "@/components/domain/form";
import { BookmarkletLink, CopyCode } from "@/components/domain/bookmarklet";
import { AirbnbExtensionSetup } from "@/components/domain/airbnb-extension";
import { collectAirbnbListing } from "@/lib/airbnb/listing-collect";
import { MAX_IMPORTED_PHOTOS, mergeListing } from "@/lib/airbnb/listing-page";
import { hasPrices, isHostPage } from "@/lib/airbnb/listing-prices";
import { WEBSITE_AMENITIES } from "@/lib/website-options";
import { WebsiteForm, type WebsiteDefaults } from "../[id]/website/website-form";
import {
  applyAirbnbFacts,
  copyAirbnbPhotos,
  loadUnitWebsite,
  readAirbnbListing,
  type ImportUnit,
  type ListingCapture,
} from "./actions";
import { PricesReview } from "./prices";

type Unit = { id: string; label: string };
type Found = Extract<ListingCapture, { listing: unknown }>;
type Ready = { unit: ImportUnit; defaults: WebsiteDefaults; found: Found; failed: number };

/** The unit picked on its Website tab, for the tab the button opens later. */
const REMEMBER = "drp.airbnb-import.unit";
const REMEMBER_FOR = 2 * 60 * 60 * 1000;
const BATCH = 6;

function rememberedUnit(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(REMEMBER) ?? "null") as { id?: string; at?: number } | null;
    return v?.id && v.at && Date.now() - v.at < REMEMBER_FOR ? v.id : null;
  } catch {
    return null;
  }
}

export function ListingImport({
  bookmarklet,
  units,
  presetUnitId,
}: {
  bookmarklet: string;
  units: Unit[];
  presetUnitId: string | null;
}) {
  const [capture, setCapture] = React.useState<ListingCapture | null>(null);
  const [ready, setReady] = React.useState<Ready | null>(null);
  const [pasted, setPasted] = React.useState("");
  const [reading, startReading] = React.useTransition();

  const read = React.useCallback((sent: unknown) => {
    startReading(async () => setCapture(await readAirbnbListing(sent)));
  }, []);

  React.useEffect(() => {
    if (!presetUnitId) return;
    try {
      localStorage.setItem(REMEMBER, JSON.stringify({ id: presetUnitId, at: Date.now() }));
    } catch {
      // Private window: the unit is picked by hand instead.
    }
  }, [presetUnitId]);

  // Sent by the button: the listing in the fragment. Read once, then dropped
  // from the address bar and history.
  React.useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    try {
      read(JSON.parse(decodeURIComponent(hash)));
    } catch {
      setCapture({ error: "The listing could not be read. Try the button again, or paste the page below." });
    }
  }, [read]);

  function readPasted() {
    const text = pasted.trim();
    // A page source (⌘ + Option + U): read like the button reads the page.
    if (/<script[\s>]/i.test(text) || /^<!doctype html/i.test(text)) {
      const doc = new DOMParser().parseFromString(text, "text/html");
      const url =
        doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
        doc.querySelector('meta[property="og:url"]')?.getAttribute("content") ??
        "";
      read(collectAirbnbListing(doc, url, false));
    } else {
      read({ text: text.slice(0, 100_000) });
    }
  }

  const reset = () => {
    setReady(null);
    setCapture(null);
  };

  if (reading) return <p className="text-sm text-[var(--muted-foreground)]">Reading the listing…</p>;
  if (ready) return <Filled ready={ready} onReset={reset} />;
  if (capture && !("error" in capture)) {
    return (
      <Found
        found={capture}
        units={units}
        initialUnit={capture.unitId ?? presetUnitId ?? rememberedUnit() ?? ""}
        onReady={setReady}
        onReset={reset}
      />
    );
  }

  return (
    <div className="space-y-5">
      {capture && "error" in capture && <FormError message={capture.error} />}
      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <AirbnbExtensionSetup
            fallback={
              <>
                <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
                  <li>
                    Show the bookmarks bar: <strong>⌘ + Shift + B</strong> on a Mac (Ctrl + Shift + B on Windows).
                  </li>
                  <li>Drag this button onto the bookmarks bar:</li>
                </ol>
                <BookmarkletLink code={bookmarklet} label="Import listing to D|R|P" />
                <details className="rounded-md border border-[var(--border)] p-3">
                  <summary className="cursor-pointer font-medium">Dragging does not work? Add it by hand</summary>
                  <div className="mt-3 space-y-3">
                    <CopyCode code={bookmarklet} />
                    <div>
                      <p className="font-medium">Chrome</p>
                      <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
                        <li>
                          Press <strong>⌘ + Option + B</strong> (Bookmark manager).
                        </li>
                        <li>
                          Click <strong>Bookmarks bar</strong> on the left, then the <strong>⋮</strong> menu at the top
                          right, then <strong>Add new bookmark</strong>.
                        </li>
                        <li>
                          Name: <strong>Import listing to D|R|P</strong>. URL: paste (<strong>⌘ + V</strong>). Save.
                        </li>
                      </ol>
                    </div>
                    <div>
                      <p className="font-medium">Safari</p>
                      <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
                        <li>
                          Bookmark any page with <strong>⌘ + D</strong>, into <strong>Favourites</strong>, named{" "}
                          <strong>Import listing to D|R|P</strong>.
                        </li>
                        <li>
                          Right-click the new bookmark in the favourites bar, choose <strong>Edit Address</strong> and paste
                          (<strong>⌘ + V</strong>) over it.
                        </li>
                      </ol>
                    </div>
                  </div>
                </details>
                <p className="text-[var(--muted-foreground)]">
                  Then use <strong>Import listing to D|R|P</strong> on the bookmarks bar wherever the steps below say
                  the D|R|P button.
                </p>
              </>
            }
          />
          <p className="font-medium">Using it</p>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
            <li>Stay signed in to this portal.</li>
            <li>
              On Airbnb open the listing as guests see it (<strong>airbnb.com/rooms/…</strong>; on the hosting side:
              Listings → the listing → <strong>View</strong>). The host&apos;s listing editor works too, with fewer
              details.
            </li>
            <li>
              Click the black <strong>D|R|P Import</strong> button at the bottom right of the page, then{" "}
              <strong>Import listing</strong>. This page opens with the listing: pick the unit and the
              photos, and the unit&apos;s Website form opens filled in. Check it and save - nothing goes on the
              website until you tick <strong>Published</strong> and save.
            </li>
          </ol>
          <p className="font-medium">Prices</p>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
            <li>
              On Airbnb open <strong>Listings</strong> → the listing → <strong>Pricing</strong> (nightly and weekend
              price, discounts, cleaning fee) and click <strong>D|R|P Import</strong> → <strong>Import listing</strong>{" "}
              there. Each price
              shows what changes on the unit; check and save. Only AED prices are taken.
            </li>
            <li>
              For seasonal rates, do the same on the listing&apos;s <strong>Calendar</strong>: where Airbnb labels
              the days with their prices, the coming nights become the website&apos;s seasons.
            </li>
            <li>
              With the extension (version 1.1 or later) prices also save on their own: whenever a listing&apos;s
              Pricing or Calendar page is open on Airbnb, its unit takes the prices shown (AED only) and a note on
              Airbnb says what changed. Smart Pricing changes arrive the next time that page is opened.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <p className="font-medium">Or copy and paste the page</p>
          <p className="text-[var(--muted-foreground)]">
            Best, with the photos: on the listing press <strong>⌘ + Option + U</strong> (view the page source; in
            Safari turn on Settings → Advanced → <em>Show features for web developers</em> first), then{" "}
            <strong>⌘ + A</strong>, <strong>⌘ + C</strong>, and paste it here. Without photos: press{" "}
            <strong>⌘ + A</strong> and <strong>⌘ + C</strong> on the listing itself (open{" "}
            <em>Show all amenities</em> first to bring them all).
          </p>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder="Paste the Airbnb listing page (or its source) here"
            aria-label="Airbnb listing page"
          />
          <p className="text-[var(--muted-foreground)]">
            Prices: on the Pricing page press <strong>⌘ + A</strong>, <strong>⌘ + C</strong> and paste it here.
          </p>
          <Button type="button" disabled={pasted.trim().length < 20} onClick={readPasted}>
            <ClipboardPaste className="size-4" />
            Read the listing
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** A listing page fills the Website form; a pricing or calendar page, the unit's rates. */
function Found(props: React.ComponentProps<typeof Review>) {
  const { listing, prices } = props.found;
  const hasListing = Boolean(listing.description || listing.photos.length || listing.amenities.length);
  const [mode, setMode] = React.useState<"listing" | "prices">(
    hasPrices(prices) && (isHostPage(listing.url) || !hasListing) ? "prices" : "listing"
  );
  return (
    <div className="space-y-5">
      {hasListing && hasPrices(prices) && (
        <div className="flex gap-2">
          <Button type="button" variant={mode === "listing" ? "default" : "outline"} onClick={() => setMode("listing")}>
            Website details
          </Button>
          <Button type="button" variant={mode === "prices" ? "default" : "outline"} onClick={() => setMode("prices")}>
            Prices
          </Button>
        </div>
      )}
      {mode === "prices" ? (
        <PricesReview found={props.found} units={props.units} initialUnit={props.initialUnit} onReset={props.onReset} />
      ) : (
        <Review {...props} />
      )}
    </div>
  );
}

function Review({
  found,
  units,
  initialUnit,
  onReady,
  onReset,
}: {
  found: Found;
  units: Unit[];
  initialUnit: string;
  onReady: (r: Ready) => void;
  onReset: () => void;
}) {
  const { listing, amenityIds, unmatched } = found;
  const [unitId, setUnitId] = React.useState(units.some((u) => u.id === initialUnit) ? initialUnit : "");
  const [picked, setPicked] = React.useState(() => new Set(listing.photos.slice(0, MAX_IMPORTED_PHOTOS)));
  const [keep, setKeep] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [error, setError] = React.useState<string>();

  const toggle = (src: string) =>
    setPicked((set) => {
      const next = new Set(set);
      if (next.has(src)) next.delete(src);
      else if (next.size < MAX_IMPORTED_PHOTOS) next.add(src);
      else toast.error(`At most ${MAX_IMPORTED_PHOTOS} photos.`);
      return next;
    });

  async function go() {
    setError(undefined);
    setProgress({ done: 0, total: 0 });
    try {
      const loaded = await loadUnitWebsite(unitId);
      if ("error" in loaded) {
        setProgress(null);
        return setError(loaded.error);
      }
      const room = keep ? Math.max(0, MAX_IMPORTED_PHOTOS - loaded.defaults.images.length) : MAX_IMPORTED_PHOTOS;
      const chosen = listing.photos.filter((p) => picked.has(p)).slice(0, room);
      const copied: string[] = [];
      let failed = 0;
      setProgress({ done: 0, total: chosen.length });
      for (let i = 0; i < chosen.length; i += BATCH) {
        const batch = chosen.slice(i, i + BATCH);
        try {
          for (const r of await copyAirbnbPhotos(batch)) {
            if (r.url) copied.push(r.url);
            else failed++;
          }
        } catch {
          failed += batch.length;
        }
        setProgress({ done: Math.min(i + BATCH, chosen.length), total: chosen.length });
      }
      onReady({
        unit: loaded.unit,
        defaults: mergeListing(loaded.defaults, listing, copied, keep),
        found,
        failed,
      });
    } catch {
      setProgress(null);
      setError("The import stopped. Check the connection and try again.");
    }
  }

  if (progress) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="size-4 animate-spin" />
        {progress.total ? `Copying photos to the portal: ${progress.done} of ${progress.total}…` : "Opening the unit…"}
      </p>
    );
  }

  const facts = [
    listing.bedrooms != null && (listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bedrooms`),
    listing.bathrooms != null && `${listing.bathrooms} bathrooms`,
    listing.guests != null && `${listing.guests} guests`,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <FormError message={error} />
      {!listing.photos.length && (
        <Callout tone="warning" title="No photos were found">
          The page&apos;s text came without photos. Use the button on the listing, or paste the page source - or
          add photos in the form yourself.
        </Callout>
      )}

      <FormSection title="From Airbnb" columns={1}>
        <div className="space-y-1 text-sm">
          <p className="font-medium">{listing.title ?? "No title found"}</p>
          {facts.length > 0 && <p className="text-[var(--muted-foreground)]">{facts.join(" · ")}</p>}
          {listing.url && (
            <a className="break-all text-xs underline" href={listing.url} target="_blank" rel="noreferrer">
              {listing.url}
            </a>
          )}
          {listing.description && (
            <p className="line-clamp-3 whitespace-pre-line text-[var(--muted-foreground)]">{listing.description}</p>
          )}
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">Amenities for the website ({amenityIds.length})</p>
          <p className="text-[var(--muted-foreground)]">
            {amenityIds.length ? amenityIds.map((id) => WEBSITE_AMENITIES[id]).join(", ") : "None recognised."}
          </p>
          {unmatched.length > 0 && (
            <details className="text-xs text-[var(--muted-foreground)]">
              <summary className="cursor-pointer">{unmatched.length} not on the website&apos;s list (left out)</summary>
              <p className="mt-1">{unmatched.join(", ")}</p>
            </details>
          )}
        </div>
      </FormSection>

      <FormSection title="Unit">
        <div className="space-y-1.5 sm:col-span-2">
          <Select aria-label="Unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Select the unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </Select>
          {found.unitId && unitId === found.unitId && (
            <p className="text-xs text-[var(--muted-foreground)]">Found from the unit&apos;s Airbnb calendar.</p>
          )}
        </div>
      </FormSection>

      {listing.photos.length > 0 && (
        <FormSection
          title={`Photos (${picked.size} of ${listing.photos.length} chosen)`}
          description="Click a photo to leave it out. They are copied to the portal, so the website never loads them from Airbnb."
          columns={1}
        >
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
            {listing.photos.map((src, i) => (
              <li key={src}>
                <button
                  type="button"
                  onClick={() => toggle(src)}
                  aria-pressed={picked.has(src)}
                  aria-label={`Photo ${i + 1}`}
                  className={`relative block aspect-[4/3] w-full overflow-hidden rounded-md border-2 ${
                    picked.has(src) ? "border-[var(--primary)]" : "border-transparent opacity-40"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${src}?im_w=320`} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="keep" checked={!keep} onChange={() => setKeep(false)} className="size-4" />
              Replace the unit&apos;s website photos
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="keep" checked={keep} onChange={() => setKeep(true)} className="size-4" />
              Add after the unit&apos;s website photos
            </label>
          </div>
        </FormSection>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onReset}>
          <RotateCcw className="size-4" />
          Start over
        </Button>
        <Button type="button" disabled={!unitId} onClick={go}>
          {picked.size ? `Copy ${picked.size} photos and fill the form` : "Fill the form"}
        </Button>
      </div>
    </div>
  );
}

function Filled({ ready, onReset }: { ready: Ready; onReset: () => void }) {
  const { unit, defaults, found, failed } = ready;
  const l = found.listing;
  const [applying, startApplying] = React.useTransition();
  const [applied, setApplied] = React.useState(false);
  const differs =
    (l.bedrooms != null && l.bedrooms !== unit.bedrooms) ||
    (l.bathrooms != null && l.bathrooms !== unit.bathrooms) ||
    (l.guests != null && l.guests !== unit.maxGuests);
  const show = (n: number | null) => (n == null ? "—" : String(n));

  return (
    <div className="space-y-5">
      <Callout tone="info" title={`${unit.label}: the Website form, filled in from Airbnb`}>
        Check every field, then save at the bottom. Nothing is saved yet, and the home only shows on the website when
        <strong> Published</strong> is ticked. Area and type are yours to choose.{" "}
        <Link className="underline" href={`/units/${unit.id}/website`}>
          Leave without importing
        </Link>
      </Callout>
      {failed > 0 && (
        <Callout tone="warning" title={`${failed} photo${failed === 1 ? "" : "s"} could not be copied`}>
          They are left out. Upload them yourself if they are needed.
        </Callout>
      )}
      {!unit.hasRate && (
        <Callout tone="warning" title="No nightly rate yet">
          Set a nightly rate in the unit&apos;s <Link className="underline" href={`/units/${unit.id}/edit`}>details</Link>{" "}
          before publishing.
        </Callout>
      )}
      {differs && !applied && (
        <Callout tone="info" title="Airbnb and the unit differ">
          <p>
            Airbnb: {show(l.bedrooms)} bedrooms, {show(l.bathrooms)} bathrooms, {show(l.guests)} guests. The unit:{" "}
            {show(unit.bedrooms)} bedrooms, {show(unit.bathrooms)} bathrooms, {show(unit.maxGuests)} guests. The website
            shows the unit&apos;s numbers.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={applying}
            onClick={() =>
              startApplying(async () => {
                const r = await applyAirbnbFacts(unit.id, { bedrooms: l.bedrooms, bathrooms: l.bathrooms, maxGuests: l.guests });
                if (r.error) toast.error(r.error);
                else {
                  toast.success(r.success!);
                  setApplied(true);
                }
              })
            }
          >
            Use Airbnb&apos;s numbers on the unit
          </Button>
        </Callout>
      )}
      <WebsiteForm unitId={unit.id} d={defaults} />
      <Button type="button" variant="ghost" onClick={onReset}>
        <RotateCcw className="size-4" />
        Start over
      </Button>
    </div>
  );
}
