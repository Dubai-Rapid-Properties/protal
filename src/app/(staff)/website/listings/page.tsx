import Link from "next/link";
import { Globe, ImageOff, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, EmptyState, PageHeader } from "@/components/domain/shared";
import { ExportButton } from "@/components/domain/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAED } from "@/lib/money";
import { LISTING_STATUSES, OFFERINGS, imagesOf, type ListingStatus } from "@/lib/listings";
import { env } from "@/lib/env";
import { RebuildButton } from "./rebuild-button";

export const metadata = { title: "Website listings" };

const VIEWS = { all: "All", buy: "For sale", rent: "For rent" } as const;
const STATUS_FILTER = { any: "Any status", published: "On the website", draft: "Drafts", hidden: "Hidden" } as const;

const SAVED: Record<string, { tone: "info" | "warning"; title: string; text: string }> = {
  live: { tone: "info", title: "Saved", text: "The website is rebuilding. The change appears in about 2 minutes." },
  pending: {
    tone: "warning",
    title: "Saved",
    text: "The website rebuild is not connected yet, so the change appears on the website's next deploy.",
  },
  saved: { tone: "info", title: "Saved", text: "This listing is not on the website, so the website was left as it is." },
  deleted: { tone: "info", title: "Listing deleted", text: "It was not on the website." },
  removed: {
    tone: "info",
    title: "Listing deleted",
    text: "It stays off the website for good. To show it again, use Restore on the Property Finder listings page.",
  },
};

export default async function WebsiteListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; q?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const view = params.view && params.view in VIEWS ? (params.view as keyof typeof VIEWS) : "all";
  const status = params.status && params.status in STATUS_FILTER ? (params.status as keyof typeof STATUS_FILTER) : "any";
  const q = (params.q ?? "").trim().toLowerCase();
  const saved = params.saved ? SAVED[params.saved] : undefined;

  const supabase = await createClient();
  const [, { data, error }] = await Promise.all([
    requireCapability("website.manage"),
    supabase
      .from("website_listings")
      .select("*")
      // Deleted Property Finder listings: only their address is kept, on the Property Finder page.
      .neq("status", "removed")
      .order("listed_at", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  const all = data ?? [];
  const listings = all.filter(
    (l) =>
      (view === "all" || l.offering === view) &&
      (status === "any" || l.status === status) &&
      (!q || [l.title, l.area, l.building, l.ref, l.slug, l.agent].some((f) => f?.toLowerCase().includes(q)))
  );
  const live = all.filter((l) => l.status === "published");
  const href = (next: Partial<{ view: string; status: string; q: string }>) => {
    const p = new URLSearchParams();
    const v = next.view ?? view;
    const s = next.status ?? status;
    const query = next.q ?? params.q ?? "";
    if (v !== "all") p.set("view", v);
    if (s !== "any") p.set("status", s);
    if (query) p.set("q", query);
    const qs = p.toString();
    return `/website/listings${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Website listings"
        description={`Listings added here appear on the D|R|P website next to the Property Finder listings; one with the same web address as a Property Finder listing replaces it. ${live.length} on the website now: ${live.filter((l) => l.offering === "buy").length} for sale, ${live.filter((l) => l.offering === "rent").length} for rent.`}
        actions={
          <>
            <ExportButton
              filename="drp-website-listings"
              rows={listings.map((l) => ({
                Title: l.title,
                Status: LISTING_STATUSES[l.status as ListingStatus],
                Offering: OFFERINGS[l.offering as keyof typeof OFFERINGS],
                "Price (AED)": Number(l.price_aed),
                Type: l.property_type,
                Area: l.area,
                Building: l.building ?? "",
                Beds: l.beds,
                Baths: l.baths,
                "Size (sq ft)": l.size_sqft,
                Agent: l.agent ?? "",
                "DLD permit": l.permit ?? "",
                Reference: l.ref ?? "",
                "Web address": `/properties/${l.slug}`,
              }))}
            />
            <Button asChild variant="outline">
              <Link href="/website/listings/property-finder">Property Finder listings</Link>
            </Button>
            <RebuildButton configured={Boolean(env.websiteDeployHookUrl)} />
            <Button asChild>
              <Link href="/website/listings/new">
                <Plus className="size-4" />
                New listing
              </Link>
            </Button>
          </>
        }
      />

      {saved && (
        <div className="mb-5">
          <Callout tone={saved.tone} title={saved.title}>
            {saved.text}
          </Callout>
        </div>
      )}
      {error && (
        <div className="mb-5">
          <Callout tone="danger" title="Listings could not be loaded">
            {error.message.includes("website_listings")
              ? "The database is not up to date yet. Run npm run db:migrate."
              : error.message}
          </Callout>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={view}>
          <TabsList>
            {Object.entries(VIEWS).map(([key, label]) => (
              <TabsTrigger key={key} value={key} asChild>
                <Link href={href({ view: key })}>{label}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <form action="/website/listings" className="flex flex-wrap items-center gap-2">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <select
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border border-[var(--input)] bg-transparent px-2 text-sm"
            aria-label="Status"
          >
            {Object.entries(STATUS_FILTER).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Title, area, building, ref" className="w-56 pl-8" />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
        </form>
      </div>

      {listings.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "No listings yet" : "Nothing matches"}
          description={
            all.length === 0
              ? "The website shows the Property Finder listings on its own. Add a listing here for anything that is not on Property Finder."
              : "Change the filters or the search."
          }
          icon={<Globe className="size-8" />}
          action={
            all.length === 0 ? (
              <Button asChild>
                <Link href="/website/listings/new">New listing</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {listings.map((l) => {
            const cover = imagesOf(l)[0];
            return (
              <Link key={l.id} href={`/website/listings/${l.id}`} className="group">
                <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
                  <div className="relative aspect-[4/3] bg-[var(--muted)]">
                    {cover ? (
                      // Photos come from several hosts (uploads, Property Finder).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-[var(--muted-foreground)]">
                        <ImageOff className="size-8" />
                      </div>
                    )}
                    <div className="absolute left-2 top-2 flex gap-1.5">
                      <Badge variant={l.status === "published" ? "success" : "muted"}>
                        {LISTING_STATUSES[l.status as ListingStatus]}
                      </Badge>
                      <Badge variant="muted">{l.offering === "buy" ? "Sale" : "Rent"}</Badge>
                    </div>
                  </div>
                  <div className="space-y-1 p-4">
                    <p className="line-clamp-2 font-semibold leading-snug">{l.title}</p>
                    <p className="tabular text-sm font-medium">
                      {formatAED(Number(l.price_aed), { decimals: false })}
                      {l.offering === "rent" && <span className="text-[var(--muted-foreground)]"> / year</span>}
                    </p>
                    <p className="truncate text-sm text-[var(--muted-foreground)]">
                      {[l.building, l.area].filter(Boolean).join(", ")}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {l.beds === 0 ? "Studio" : `${l.beds} bed`} · {l.baths} bath · {l.size_sqft.toLocaleString("en-US")} sq ft ·{" "}
                      {l.property_type}
                    </p>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
