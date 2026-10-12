import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/domain/shared";
import { env } from "@/lib/env";
import { teamPhotoSrc } from "@/lib/website-team";
import { TeamForm } from "../team-form";

export const metadata = { title: "Team member" };

export default async function EditTeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [, { data: member }] = await Promise.all([
    requireCapability("website.manage"),
    supabase.from("website_team").select("*").eq("id", id).maybeSingle(),
  ]);
  if (!member) notFound();
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Website team", href: "/website/team" }]}
        title={member.name}
        description={member.role || "Team member"}
      />
      <TeamForm
        member={member}
        photoSrc={teamPhotoSrc(member.photo_url, env.websiteUrl)}
        websiteUrl={env.websiteUrl}
        nextOrder={member.sort_order}
      />
    </>
  );
}
