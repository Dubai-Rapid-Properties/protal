import { Newspaper } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, EmptyState, PageHeader } from "@/components/domain/shared";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/env";
import { DeleteNewsButton, NewsForm } from "./news-form";

export const metadata = { title: "Website news" };

/**
 * The articles on /news of the D|R|P website ("Stay Ahead of the Market"), next to the UAE
 * property stories the website takes from Forbes Middle East's and The National's feeds itself.
 */
export default async function WebsiteNewsPage() {
  const supabase = await createClient();
  const [, { data, error }] = await Promise.all([
    requireCapability("website.manage"),
    supabase.from("website_news").select("*").order("published_on", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  const news = data ?? [];

  return (
    <>
      <PageHeader
        title="Website news"
        description={`Articles on ${env.websiteUrl.replace(/^https?:\/\//, "")}/news. Forbes Middle East's and The National's UAE property stories appear there by themselves; add stories from any other publication here.`}
      />
      {error && (
        <div className="mb-5">
          <Callout tone="danger" title="The news could not be loaded">
            {error.message.includes("website_news") ? "The database is not up to date yet. Run npm run db:migrate (migration 0064)." : error.message}
          </Callout>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <NewsForm />
        <div className="space-y-3">
          {news.length === 0 ? (
            <EmptyState title="No articles added yet" description="Paste a link on the left to put a story on the website." icon={<Newspaper className="size-8" />} />
          ) : (
            news.map((n) => (
              <Card key={n.id} className="flex items-start gap-4 p-4">
                {n.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex size-20 shrink-0 items-center justify-center rounded-md bg-[var(--muted)]">
                    <Newspaper className="size-6 text-[var(--muted-foreground)]" />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    {n.source} · {n.published_on}
                  </p>
                  <a href={n.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                    {n.title}
                  </a>
                  {n.summary && <p className="line-clamp-2 text-sm text-[var(--muted-foreground)]">{n.summary}</p>}
                </div>
                <DeleteNewsButton id={n.id} title={n.title} />
              </Card>
            ))
          )}
        </div>
      </div>
    </>
  );
}
