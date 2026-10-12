import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, PageHeader } from "@/components/domain/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatAED } from "@/lib/money";
import { fetchPropertyFinderListings, restoreListing, takeOver } from "./actions";
import { ConfirmSubmitButton } from "./confirm-button";

export const metadata = { title: "Property Finder listings" };

type PfListing = {
  slug: string;
  title: string;
  offering: string;
  price: number;
  area: string;
  building: string | null;
  beds: number;
  images?: string[];
  type: string;
};

const ERRORS: Record<string, string> = {
  permission: "You do not have permission to edit website listings.",
  website: "The website's Property Finder list could not be read. Try again in a moment.",
  listing: "This listing cannot be copied (it is not a home the website shows).",
};

export default async function PropertyFinderListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  const { q = "", error } = await searchParams;
  const [, pf] = await Promise.all([requireCapability("website.manage"), fetchPropertyFinderListings()]);
  const supabase = await createClient();
  const { data: rows } = await supabase.from("website_listings").select("id, slug, status");
  const taken = new Map((rows ?? []).map((r) => [r.slug, r]));

  const needle = q.trim().toLowerCase();
  const list = ((pf ?? []) as PfListing[]).filter(
    (l) =>
      l.slug &&
      (!needle || [l.title, l.area, l.building, l.slug].some((f) => f?.toLowerCase().includes(needle)))
  );

  return (
    <>
      <PageHeader
        title="Property Finder listings"
        description="These come from Property Finder automatically. To change one on the website, edit it: a copy is saved here and shown instead of Property Finder's. You can also hide one from the website. Property Finder itself is not changed, and an edited listing no longer follows changes made there."
        actions={
          <Button asChild variant="outline">
            <Link href="/website/listings">
              <ArrowLeft className="size-4" />
              Website listings
            </Link>
          </Button>
        }
      />

      {error && (
        <div className="mb-5">
          <Callout tone="danger" title="Could not do that">
            {ERRORS[error] ?? error}
          </Callout>
        </div>
      )}
      {!pf && (
        <div className="mb-5">
          <Callout tone="warning" title="Property Finder listings unavailable">
            The website did not answer. Check WEBSITE_URL, or try again in a moment.
          </Callout>
        </div>
      )}

      <form action="/website/listings/property-finder" className="mb-4 flex gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
          <Input name="q" defaultValue={q} placeholder="Title, area, building" className="w-64 pl-8" />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      <div className="grid gap-3">
        {list.map((l) => {
          const mine = taken.get(l.slug);
          return (
            <Card key={l.slug} className="flex flex-wrap items-center gap-4 p-3">
              {l.images?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.images[0]} alt="" loading="lazy" className="size-16 rounded object-cover" />
              ) : (
                <div className="size-16 rounded bg-[var(--muted)]" />
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 font-medium">{l.title}</p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {[l.building, l.area].filter(Boolean).join(", ")} · {l.beds === 0 ? "Studio" : `${l.beds} bed`} ·{" "}
                  {formatAED(Number(l.price), { decimals: false })}
                  {l.offering === "rent" ? " / year" : ""}
                </p>
              </div>
              {mine && (
                <Badge variant={mine.status === "published" ? "success" : "muted"}>
                  {mine.status === "published"
                    ? "Edited here"
                    : mine.status === "hidden"
                      ? "Hidden"
                      : mine.status === "removed"
                        ? "Deleted"
                        : "Draft"}
                </Badge>
              )}
              {mine?.status === "removed" ? (
                <form action={restoreListing}>
                  <input type="hidden" name="slug" value={l.slug} />
                  <ConfirmSubmitButton
                    size="sm"
                    variant="outline"
                    message={`Restore "${l.title}"? It shows on the website again, as on Property Finder.`}
                  >
                    Restore
                  </ConfirmSubmitButton>
                </form>
              ) : (
                <form action={takeOver} className="flex gap-2">
                  <input type="hidden" name="slug" value={l.slug} />
                  {mine ? (
                    <Button type="submit" name="mode" value="edit" size="sm">
                      Open
                    </Button>
                  ) : (
                    <ConfirmSubmitButton
                      name="mode"
                      value="edit"
                      size="sm"
                      message={`Edit "${l.title}"? A copy is saved here and shown on the website straight away instead of Property Finder's, and it no longer follows changes made on Property Finder.`}
                    >
                      Edit
                    </ConfirmSubmitButton>
                  )}
                  {mine?.status !== "hidden" && (
                    <ConfirmSubmitButton
                      name="mode"
                      value="hide"
                      size="sm"
                      variant="outline"
                      message={`Hide "${l.title}" from the website? Property Finder itself is not changed.`}
                    >
                      Hide
                    </ConfirmSubmitButton>
                  )}
                </form>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
