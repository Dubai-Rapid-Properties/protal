import Link from "next/link";
import { ArrowRight, Download, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { EmptyState, PageHeader } from "@/components/domain/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Add a holiday home" };

/**
 * A holiday home on the website is a short-term unit with website details. Pick a unit that
 * isn't on the website yet, or add the unit first, or bring the details in from Airbnb.
 */
export default async function NewHolidayHomePage() {
  await requireCapability("units.manage");
  const supabase = await createClient();
  const { data } = await supabase
    .from("units")
    .select("id, unit_number, bedrooms, website_title, properties(name)")
    .eq("is_active", true)
    .in("operating_mode", ["short_term", "both"])
    .eq("website_published", false)
    .order("unit_number");
  const units = (data ?? []).map((u) => ({
    ...u,
    building: (u.properties as { name: string } | null)?.name ?? "",
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Holiday homes", href: "/website/holiday-homes" }]}
        title="Add a holiday home"
        description="Every holiday home on the website is a short-term unit, so its calendar, Airbnb sync and bookings work as for any other unit."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="font-medium">A new property</p>
            <p className="text-[var(--muted-foreground)]">
              Add the unit (building, owner, permit, short-term), then fill in its website details: title, photos,
              description and amenities.
            </p>
            <Button asChild>
              <Link href="/units/new">
                <Plus className="size-4" />
                Add a unit
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="font-medium">From its Airbnb listing</p>
            <p className="text-[var(--muted-foreground)]">
              Fill the title, description, photos and amenities in from the listing on Airbnb, then check and publish.
            </p>
            <Button asChild variant="outline">
              <Link href="/units/from-airbnb">
                <Download className="size-4" />
                Import from Airbnb
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-base font-semibold">Or put an existing unit on the website</h2>
      {units.length === 0 ? (
        <EmptyState
          title="Every short-term unit is already on the website"
          description="Add a unit first, or set an existing one to short-term in its details."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {units.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/units/${u.id}/website`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[var(--muted)]"
                >
                  <span>
                    <span className="font-medium">
                      {u.building} · {u.unit_number}
                    </span>
                    <span className="text-[var(--muted-foreground)]">
                      {" "}
                      · {Number(u.bedrooms) === 0 ? "Studio" : `${Number(u.bedrooms)} bed`}
                      {u.website_title ? ` · “${u.website_title}” (not published)` : " · no website details yet"}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-[var(--muted-foreground)]" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
