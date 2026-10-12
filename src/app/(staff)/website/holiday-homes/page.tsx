import Link from "next/link";
import { BedDouble, Download, ImageOff, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, EmptyState, PageHeader } from "@/components/domain/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAED } from "@/lib/money";
import { imagesOf } from "@/lib/website-homes";

export const metadata = { title: "Holiday homes on the website" };

const VIEWS = { all: "All", live: "On the website", draft: "Not published" } as const;

/** Every short-term unit and how it looks on the Holiday Homes website. Editing opens the unit's Website tab. */
export default async function WebsiteHolidayHomesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const params = await searchParams;
  const view = params.view && params.view in VIEWS ? (params.view as keyof typeof VIEWS) : "all";
  const q = (params.q ?? "").trim().toLowerCase();

  await requireCapability("units.manage");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .select(
      "id, unit_number, bedrooms, max_guests, base_nightly_rate_aed, website_published, website_title, website_slug, website_area, website_images, properties(name)",
    )
    .eq("is_active", true)
    .in("operating_mode", ["short_term", "both"])
    .order("website_published", { ascending: false })
    .order("website_title", { ascending: true, nullsFirst: false });

  const all = (data ?? []).map((u) => ({
    ...u,
    building: (u.properties as { name: string } | null)?.name ?? "",
    setUp: Boolean(u.website_title),
  }));
  const homes = all.filter(
    (u) =>
      (view === "all" || (view === "live" ? u.website_published : !u.website_published)) &&
      (!q ||
        [u.website_title, u.website_area, u.website_slug, u.building, u.unit_number].some((f) =>
          f?.toLowerCase().includes(q),
        )),
  );
  const live = all.filter((u) => u.website_published).length;
  const href = (next: Partial<{ view: string }>) => {
    const p = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== "all") p.set("view", v);
    if (params.q) p.set("q", params.q);
    const qs = p.toString();
    return `/website/holiday-homes${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Holiday homes"
        description={`The homes on the Holiday Homes website. Each is a short-term unit: its calendar, Airbnb sync and bookings stay on the unit. ${live} of ${all.length} on the website now.`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/units/from-airbnb">
                <Download className="size-4" />
                Import from Airbnb
              </Link>
            </Button>
            <Button asChild>
              <Link href="/website/holiday-homes/new">
                <Plus className="size-4" />
                Add holiday home
              </Link>
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-5">
          <Callout tone="danger" title="Holiday homes could not be loaded">
            {error.message}
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
        <form action="/website/holiday-homes" className="flex items-center gap-2">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Title, area, building, unit" className="w-56 pl-8" />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>
      </div>

      {homes.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "No short-term units yet" : "Nothing matches"}
          description={
            all.length === 0
              ? "A holiday home starts as a unit set to short-term (or both). Add one, then give it its website details."
              : "Change the tab or the search."
          }
          icon={<BedDouble className="size-8" />}
          action={
            all.length === 0 ? (
              <Button asChild>
                <Link href="/website/holiday-homes/new">Add holiday home</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {homes.map((u) => {
            const cover = imagesOf(u)[0];
            const rate = Number(u.base_nightly_rate_aed);
            return (
              <Link key={u.id} href={`/units/${u.id}/website`} className="group">
                <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
                  <div className="relative aspect-[4/3] bg-[var(--muted)]">
                    {cover ? (
                      // Photos come from the portal's storage (and older website uploads).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-[var(--muted-foreground)]">
                        <ImageOff className="size-8" />
                      </div>
                    )}
                    <div className="absolute left-2 top-2">
                      <Badge variant={u.website_published ? "success" : "muted"}>
                        {u.website_published ? "On the website" : u.setUp ? "Not published" : "Not set up"}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1 p-4">
                    <p className="line-clamp-2 font-semibold leading-snug">
                      {u.website_title || `${u.building} · ${u.unit_number}`}
                    </p>
                    <p className="tabular text-sm font-medium">
                      {rate > 0 ? (
                        <>
                          {formatAED(rate, { decimals: false })}
                          <span className="text-[var(--muted-foreground)]"> / night</span>
                        </>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">No nightly rate yet</span>
                      )}
                    </p>
                    <p className="truncate text-sm text-[var(--muted-foreground)]">
                      {[`${u.building} · ${u.unit_number}`, u.website_area].filter(Boolean).join(", ")}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {Number(u.bedrooms) === 0 ? "Studio" : `${Number(u.bedrooms)} bed`}
                      {u.max_guests ? ` · sleeps ${u.max_guests}` : ""}
                      {imagesOf(u).length ? ` · ${imagesOf(u).length} photos` : ""}
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
