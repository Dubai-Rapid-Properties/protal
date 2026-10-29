import Link from "next/link";
import { Plus, Search, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState, PageHeader, StatCard } from "@/components/domain/shared";
import { MaintenanceStatusBadge, PriorityBadge } from "@/components/domain/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
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
import { MAINTENANCE_CATEGORY, TICKET_KIND } from "@/lib/labels";

export const metadata = { title: "Repairs & complaints" };

const DONE = ["completed", "closed", "rejected", "cancelled"] as const;

const VIEWS = { open: "Open", done: "Done", all: "All" } as const;
type View = keyof typeof VIEWS;

const REPORTED_BY: Record<string, string> = {
  owner: "Owner",
  tenant: "Tenant",
  guest: "Guest",
  staff: "D|R|P",
};

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; kind?: string; q?: string }>;
}) {
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "open";
  const kind = params.kind === "repair" || params.kind === "complaint" ? params.kind : "";
  const supabase = await createClient();

  let query = supabase
    .from("maintenance_requests")
    .select(
      "id, ticket_number, kind, category, priority, status, title, raised_by_kind, reported_at, owner_contact, units(id, unit_number, properties(name)), assignee:profiles!maintenance_requests_assigned_to_fkey(full_name)"
    )
    .order("reported_at", { ascending: false })
    .limit(500);
  if (view === "open") query = query.not("status", "in", `(${DONE.join(",")})`);
  if (view === "done") query = query.in("status", [...DONE]);
  if (kind) query = query.eq("kind", kind);
  if (params.q) {
    const term = params.q.replace(/[%,()]/g, "");
    query = query.or(`ticket_number.ilike.%${term}%,title.ilike.%${term}%`);
  }

  const [profile, { data, error }, openResult] = await Promise.all([
    requireCapability("maintenance.view"),
    query,
    supabase
      .from("maintenance_requests")
      .select("kind, priority, status")
      .not("status", "in", `(${DONE.join(",")})`),
  ]);

  const tickets = data ?? [];
  const open = openResult.data ?? [];
  const canRaise = can(profile.role, "maintenance.raise");

  return (
    <>
      <PageHeader
        title="Repairs & complaints"
        description="Everything reported on the units: repairs to fix and complaints to resolve, from staff and owners."
        actions={
          canRaise ? (
            <Button asChild>
              <Link href="/maintenance/new">
                <Plus className="size-4" />
                New ticket
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open repairs" value={open.filter((t) => t.kind === "repair").length} />
        <StatCard label="Open complaints" value={open.filter((t) => t.kind === "complaint").length} />
        <StatCard
          label="Emergency / high"
          value={open.filter((t) => t.priority === "emergency" || t.priority === "high").length}
        />
        <StatCard label="New, not seen" value={open.filter((t) => t.status === "submitted").length} />
      </div>

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input name="q" defaultValue={params.q ?? ""} placeholder="Ticket number or title" className="pl-8" />
            </div>
            <Select name="kind" defaultValue={kind} className="sm:w-44">
              <option value="">Repairs and complaints</option>
              <option value="repair">Repairs</option>
              <option value="complaint">Complaints</option>
            </Select>
            <Select name="view" defaultValue={view} className="sm:w-32">
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
        <EmptyState title="Could not load tickets" description={error.message} icon={<Wrench className="size-8" />} />
      ) : tickets.length === 0 ? (
        <EmptyState
          title={view === "open" ? "Nothing open" : "No tickets here"}
          description={
            view === "open"
              ? "No repairs or complaints waiting. New ones from owners appear here too."
              : "Nothing matches these filters."
          }
          icon={<Wrench className="size-8" />}
          action={
            canRaise ? (
              <Button asChild>
                <Link href="/maintenance/new">New ticket</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Reported</TableHead>
                <TableHead className="hidden lg:table-cell">Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((t) => (
                <TableRow key={t.id} className={ROW_CLICKABLE}>
                  <TableCell className="max-w-xs">
                    <Link href={`/maintenance/${t.id}`} className={ROW_LINK}>
                      {t.title}
                    </Link>
                    <p className="text-xs text-[var(--muted-foreground)]">{t.ticket_number}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {t.units?.properties?.name} · {t.units?.unit_number}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant={t.kind === "complaint" ? "brand" : "muted"}>
                      {TICKET_KIND[t.kind as keyof typeof TICKET_KIND] ?? t.kind}
                    </Badge>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{MAINTENANCE_CATEGORY[t.category]}</p>
                  </TableCell>
                  <TableCell>
                    <PriorityBadge value={t.priority} />
                  </TableCell>
                  <TableCell>
                    <MaintenanceStatusBadge status={t.status} />
                    {t.owner_contact === "pending" &&
                      !["completed", "closed", "rejected", "cancelled"].includes(t.status) && (
                        <Badge variant="danger" className="mt-1 block w-fit">
                          Owner not contacted
                        </Badge>
                      )}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm lg:table-cell">
                    {formatDate(t.reported_at)}
                    <p className="text-xs text-[var(--muted-foreground)]">
                      by {REPORTED_BY[t.raised_by_kind] ?? t.raised_by_kind}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {t.assignee?.full_name || "—"}
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
