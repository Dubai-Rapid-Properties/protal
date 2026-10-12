import { requireCapability } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/domain/shared";
import { env } from "@/lib/env";
import { TeamForm } from "../team-form";

export const metadata = { title: "Add to the team" };

export default async function NewTeamMemberPage() {
  const supabase = await createClient();
  const [, { data }] = await Promise.all([
    requireCapability("website.manage"),
    supabase.from("website_team").select("sort_order").order("sort_order", { ascending: false }).limit(1),
  ]);
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Website team", href: "/website/team" }]}
        title="Add to the team"
        description="They appear on the website after the next rebuild, which saving starts."
      />
      <TeamForm photoSrc={null} websiteUrl={env.websiteUrl} nextOrder={(data?.[0]?.sort_order ?? 0) + 10} />
    </>
  );
}
