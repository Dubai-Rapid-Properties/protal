import Link from "next/link";
import { EyeOff, Plus, Search, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState, Money, PageHeader, StatCard } from "@/components/domain/shared";
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
import { dubaiToday } from "@/lib/calendar";
import { formatDate } from "@/lib/dates";
import { INCIDENT_CATEGORY, INCIDENT_STATUS, type IncidentCategory } from "@/lib/labels";

export const metadata = { title: "Guest incidents" };

const VIEWS = { open: "Open", resolved: "Resolved", all: "All" } as const;
type View = keyof typeof VIEWS;

/**
 * What guests did to the units - mess, damage, smoking - for cleaning
 * charges, deposits and Airbnb claims. Staff only: owners never see these.
 */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "open";
  const supabase = await createClient();

  let query = supabase
    .from("guest_incidents")
    .select(
      "id, occurred_on, category, description, charge_aed, status, photo_paths, units(id, unit_number, properties(name)), bookings(id, booking_number, guests(full_name))"
    )
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (view !== "all") query = query.eq("status", view);
  if (params.q) {
    const term = params.q.replace(/[%,()]/g, "");
    query = query.ilike("description", `%${term}%`);
  }

  const [profile, { data, error }, openResult] = await Promise.all([
    requireCapability("incidents.view"),
    query,
    supabase.from("guest_incidents").select("occurred_on, charge_aed").eq("status", "open"),
  ]);

  const incidents = data ?? [];
  const open = openResult.data ?? [];
  const thisMonth = dubaiToday().slice(0, 7);
  const canReport = can(profile.role, "incidents.report");

  return (
    <>
      <PageHeader
        title="Guest incidents"
        description="What guests did to the units - mess, damage, smoking - for cleaning charges, deposits and Airbnb claims."
        actions={
          canReport ? (
            <Button asChild>
              <Link href="/incidents/new">
                <Plus className="size-4" />
                Report incident
              </Link>
            </Button>
          ) : undefined
        }
      />

      <p className="mb-4 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <EyeOff className="size-4 shrink-0" />
        Staff only. Owners never see guest incidents, their photos or charges.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Open" value={open.length} />
        <StatCard label="Open this month" value={open.filter((i) => i.occurred_on.startsWith(thisMonth)).length} />
        <StatCard
          label="Open charges"
          value={<Money amount={open.reduce((sum, i) => sum + Number(i.charge_aed ?? 0), 0)} />}
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input name="q" defaultValue={params.q ?? ""} placeholder="Search the description" className="pl-8" />
            </div>
            <Select name="view" defaultValue={view} className="sm:w-36">
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
        <EmptyState title="Could not load incidents" description={error.message} icon={<TriangleAlert className="size-8" />} />
      ) : incidents.length === 0 ? (
        <EmptyState
          title={view === "open" ? "Nothing open" : "No incidents here"}
          description={
            view === "open"
              ? "No guest incidents waiting on a charge or a follow-up."
              : "Nothing matches these filters."
          }
          icon={<TriangleAlert className="size-8" />}
          action={
            canReport ? (
              <Button asChild>
                <Link href="/incidents/new">Report incident</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What happened</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="hidden md:table-cell">Guest</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Charge</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.map((i) => (
                <TableRow key={i.id} className={ROW_CLICKABLE}>
                  <TableCell className="max-w-xs">
                    <Link href={`/incidents/${i.id}`} className={ROW_LINK}>
                      {INCIDENT_CATEGORY[i.category as IncidentCategory] ?? i.category}
                    </Link>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {formatDate(i.occurred_on)} · {i.description}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.units?.properties?.name} · {i.units?.unit_number}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {i.bookings ? (
                      <>
                        {i.bookings.guests?.full_name ?? "Guest"}
                        <p className="text-xs text-[var(--muted-foreground)]">{i.bookings.booking_number}</p>
                      </>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {i.charge_aed != null ? <Money amount={i.charge_aed} /> : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={i.status === "open" ? "warning" : "muted"}>
                      {INCIDENT_STATUS[i.status as keyof typeof INCIDENT_STATUS] ?? i.status}
                    </Badge>
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
