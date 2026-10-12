import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireCapability } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/domain/shared";
import { Button } from "@/components/ui/button";
import { dubaiToday } from "@/lib/calendar";
import { LISTING_STATUSES, type ListingStatus } from "@/lib/listings";
import { ListingForm } from "../listing-form";
import { listingFormOptions } from "../form-data";
import { env } from "@/lib/env";

export const metadata = { title: "Edit listing" };


export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [, { data: listing }, options] = await Promise.all([
    requireCapability("website.manage"),
    supabase.from("website_listings").select("*").eq("id", id).maybeSingle(),
    listingFormOptions(),
  ]);
  if (!listing) notFound();
  if (listing.status === "removed") redirect("/website/listings/property-finder");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Website listings", href: "/website/listings" }]}
        title={listing.title}
        description={`${LISTING_STATUSES[listing.status as ListingStatus]} · last changed ${new Date(listing.updated_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" })}`}
        actions={
          listing.status === "published" ? (
            <Button asChild variant="outline">
              <Link href={`${env.websiteUrl}/properties/${listing.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                View on the website
              </Link>
            </Button>
          ) : undefined
        }
      />
      <ListingForm listing={listing} {...options} today={dubaiToday()} />
    </>
  );
}
