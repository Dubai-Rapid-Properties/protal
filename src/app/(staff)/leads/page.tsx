import Link from "next/link";
import { Inbox, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { EmptyState, PageHeader, StatCard } from "@/components/domain/shared";
import { ExportButton } from "@/components/domain/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  ROW_LINK,
  ROW_CLICKABLE,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { LEAD_INTENTS, LEAD_STAGES, OPEN_STAGES, humanise, type LeadIntent, type LeadStage } from "@/lib/leads";

export const metadata = { title: "Leads" };

const VIEWS = { open: "Open", new: "New only", all: "All", closed: "Won / lost" } as const;

const formOf = (payload: unknown): string | null => {
  const form = payload && typeof payload === "object" ? (payload as Record<string, unknown>).form : null;
  return typeof form === "string" && form ? humanise(form) : null;
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const params = await searchParams;
  const view = params.view && params.view in VIEWS ? (params.view as keyof typeof VIEWS) : "open";

  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select("id, full_name, email, phone, source, intent, stage, created_at, next_follow_up_at, raw_payload, assignee:profiles!leads_assigned_to_fkey(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (view === "open") query = query.in("stage", OPEN_STAGES);
  if (view === "new") query = query.eq("stage", "new");
  if (view === "closed") query = query.in("stage", ["won", "lost"]);
  if (params.q) {
    const term = params.q.replace(/[%,()]/g, "");
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const [, { data, error }, counts] = await Promise.all([
    requireCapability("leads.manage"),
    query,
    supabase.from("leads").select("stage, created_at").in("stage", OPEN_STAGES),
  ]);
  const leads = data ?? [];
  const open = counts.data ?? [];
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;

  return (
    <>
      <PageHeader
        title="Leads"
        description="Enquiries from the D|R|P website arrive here as well as by email. Give each one an owner and move it along as you follow up."
        actions={
          <ExportButton
            filename="drp-leads"
            rows={leads.map((l) => ({
              Received: formatDate(l.created_at),
              Name: l.full_name,
              Email: l.email ?? "",
              Phone: l.phone ?? "",
              Form: formOf(l.raw_payload) ?? "",
              Interest: LEAD_INTENTS[l.intent as LeadIntent],
              Stage: LEAD_STAGES[l.stage as LeadStage],
              "Assigned to": l.assignee?.full_name || l.assignee?.email || "",
            }))}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="New, not contacted" value={open.filter((l) => l.stage === "new").length} />
        <StatCard label="Open" value={open.length} />
        <StatCard label="Open, from the last 7 days" value={open.filter((l) => Date.parse(l.created_at) >= weekAgo).length} />
      </div>

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input name="q" defaultValue={params.q ?? ""} placeholder="Name, email or phone" className="pl-8" />
            </div>
            <Select name="view" defaultValue={view} className="sm:w-40">
              {Object.entries(VIEWS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <EmptyState title="Could not load leads" description={error.message} icon={<Inbox className="size-8" />} />
      ) : leads.length === 0 ? (
        <EmptyState
          title={view === "open" || view === "new" ? "No open leads" : "No leads here"}
          description="Enquiries sent from the website's forms appear here."
          icon={<Inbox className="size-8" />}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead>Interest</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="hidden lg:table-cell">Received</TableHead>
                <TableHead className="hidden lg:table-cell">Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.id} className={ROW_CLICKABLE}>
                  <TableCell className="max-w-xs">
                    <Link href={`/leads/${l.id}`} className={ROW_LINK}>
                      {l.full_name}
                    </Link>
                    <p className="text-xs text-[var(--muted-foreground)]">{formOf(l.raw_payload) ?? humanise(l.source)}</p>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {l.email && <p className="truncate">{l.email}</p>}
                    {l.phone && <p className="text-[var(--muted-foreground)]">{l.phone}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{LEAD_INTENTS[l.intent as LeadIntent]}</TableCell>
                  <TableCell>
                    <Badge variant={l.stage === "new" ? "brand" : l.stage === "won" ? "success" : "muted"}>
                      {LEAD_STAGES[l.stage as LeadStage]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm lg:table-cell">
                    {formatDate(l.created_at)}
                    {l.next_follow_up_at && (
                      <p className="text-xs text-[var(--muted-foreground)]">Follow up {formatDate(l.next_follow_up_at)}</p>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {l.assignee?.full_name || l.assignee?.email || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
