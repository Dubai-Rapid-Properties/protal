import Link from "next/link";
import { Plus, UserRound, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, EmptyState, PageHeader } from "@/components/domain/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/env";
import { teamPhotoSrc } from "@/lib/website-team";

export const metadata = { title: "Website team" };

const SAVED: Record<string, { tone: "info" | "warning"; text: string }> = {
  live: { tone: "info", text: "Saved. The website is rebuilding; the change appears in about 2 minutes." },
  pending: { tone: "warning", text: "Saved. The website rebuild is not connected, so it appears on the next deploy." },
  deleted: { tone: "info", text: "Removed from the team. The website is rebuilding." },
};

export default async function WebsiteTeamPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const supabase = await createClient();
  const [, { data, error }] = await Promise.all([
    requireCapability("website.manage"),
    supabase.from("website_team").select("*").order("is_active", { ascending: false }).order("sort_order").order("name"),
  ]);
  const team = data ?? [];
  const note = saved ? SAVED[saved] : undefined;

  return (
    <>
      <PageHeader
        title="Website team"
        description="The people on the D|R|P website: the About page and the agent card on each listing. Pick them as the agent when you add a listing."
        actions={
          <Button asChild>
            <Link href="/website/team/new">
              <Plus className="size-4" />
              Add person
            </Link>
          </Button>
        }
      />
      {note && (
        <div className="mb-5">
          <Callout tone={note.tone} title={note.text} />
        </div>
      )}
      {error && (
        <div className="mb-5">
          <Callout tone="danger" title="The team could not be loaded">
            {error.message.includes("website_team") ? "The database is not up to date yet. Run npm run db:migrate." : error.message}
          </Callout>
        </div>
      )}
      {team.length === 0 ? (
        <EmptyState
          title="No one on the team yet"
          description="Add the people who should appear on the website."
          icon={<Users className="size-8" />}
          action={
            <Button asChild>
              <Link href="/website/team/new">Add person</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {team.map((m) => {
            const src = teamPhotoSrc(m.photo_url, env.websiteUrl);
            return (
              <Link key={m.id} href={`/website/team/${m.id}`} className="group">
                <Card className={`flex h-full items-center gap-4 p-4 transition-shadow group-hover:shadow-md ${m.is_active ? "" : "opacity-60"}`}>
                  <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--muted)]">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" className="size-full object-cover object-top" />
                    ) : (
                      <UserRound className="size-7 text-[var(--muted-foreground)]" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate font-semibold">{m.name}</p>
                    <p className="truncate text-sm text-[var(--muted-foreground)]">{m.role || "—"}</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {m.brn && <Badge variant="muted">BRN {m.brn}</Badge>}
                      {!m.is_active ? (
                        <Badge variant="muted">Inactive</Badge>
                      ) : m.show_on_about ? (
                        <Badge variant="success">About page</Badge>
                      ) : (
                        <Badge variant="muted">Listings only</Badge>
                      )}
                    </div>
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
