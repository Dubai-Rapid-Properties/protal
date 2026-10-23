import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { Button } from "@/components/ui/button";
import { websiteDefaults } from "./defaults";
import { WebsiteForm } from "./website-form";

export const metadata = { title: "Unit on the website" };

export default async function UnitWebsitePage({ params }: { params: Promise<{ id: string }> }) {
  await requireCapability("units.manage");
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.from("units").select("*, properties(name)").eq("id", id).maybeSingle();
  if (!u) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Units", href: "/units" }, { label: u.unit_number, href: `/units/${u.id}` }, { label: "Website" }]}
        title={`${u.unit_number} on the website`}
        description="What guests see on the Holiday Homes website. Bookings made there land in this unit's calendar."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={`/units/from-airbnb?unit=${u.id}`}>
              <Download className="size-4" />
              Import from Airbnb
            </Link>
          </Button>
        }
      />
      <WebsiteForm unitId={u.id} d={websiteDefaults(u)} />
    </div>
  );
}
