import Link from "next/link";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, EmptyState, Callout } from "@/components/domain/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dubaiToday } from "@/lib/calendar";
import { env } from "@/lib/env";
import { sheetCsvUrl } from "@/lib/sheet/bookings-sheet";
import { SyncStatusBadge } from "../units/[id]/channel-sync";
import { SyncAllButton } from "./sync-all-button";

export const metadata = { title: "Calendar sync" };

const dubaiTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai",
  dateStyle: "medium",
  timeStyle: "short",
});

/** Sync status of every holiday-home unit's Airbnb calendar, in one place. */
export default async function CalendarSyncPage() {
  const supabase = await createClient();
  const today = dubaiToday();

  const [profile, unitsResult, permitsResult, flaggedResult, sheetResult] = await Promise.all([
    requireCapability("bookings.view"),
    supabase
      .from("units")
      .select(
        "id, unit_number, airbnb_ical_url, ical_last_synced_at, ical_last_status, ical_last_error, ical_last_event_count, properties(name)"
      )
      .eq("is_active", true)
      .in("operating_mode", ["short_term", "both"])
      .order("unit_number"),
    supabase.from("v_units_overview").select("id, has_valid_permit, owner_name").eq("is_active", true),
    supabase
      .from("bookings")
      .select("unit_id")
      .eq("imported_without_permit", true)
      .in("status", ["confirmed", "checked_in"])
      .gt("check_out", today),
    supabase.from("bookings_sheet_sync").select("*").maybeSingle(),
  ]);
  const sheet = sheetResult.data;
  const sheetProblems = (sheet?.problems as string[] | null) ?? [];

  const permitted = new Map((permitsResult.data ?? []).map((u) => [u.id, u.has_valid_permit]));
  const ownerOf = new Map((permitsResult.data ?? []).map((u) => [u.id, u.owner_name]));
  const flagged = new Map<string, number>();
  for (const b of flaggedResult.data ?? []) flagged.set(b.unit_id, (flagged.get(b.unit_id) ?? 0) + 1);

  const units = (unitsResult.data ?? []).sort((a, b) =>
    `${a.properties?.name} ${a.unit_number}`.localeCompare(`${b.properties?.name} ${b.unit_number}`)
  );
  const linked = units.filter((u) => u.airbnb_ical_url);
  const problems = linked.filter((u) => u.ical_last_status === "error").length;
  const canManage = can(profile.role, "bookings.manage");
  const canAdd = can(profile.role, "properties.manage");
  const addButton = canAdd ? (
    <Button asChild variant={linked.length > 0 ? "outline" : "default"}>
      <Link href="/calendar-sync/add">
        <Plus className="size-4" />
        Add Airbnb listings
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Calendar sync"
        description="Airbnb calendars are imported every 15 minutes. Each unit's export link keeps Airbnb closed on dates booked elsewhere."
        actions={
          <>
            {addButton}
            {canManage && linked.length > 0 && <SyncAllButton />}
          </>
        }
      />

      {env.bookingsSheet && (
        <Card className="mb-4">
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                Bookings sheet{" "}
                <a
                  href={sheetCsvUrl(env.bookingsSheet).replace(/\/export\?format=csv.*$/, "/edit")}
                  target="_blank"
                  rel="noreferrer"
                  className="font-normal text-[var(--muted-foreground)] hover:underline"
                >
                  (open)
                </a>
              </p>
              {sheet ? (
                <Badge variant={sheet.ok ? (sheetProblems.length ? "warning" : "success") : "danger"}>
                  {sheet.ok ? (sheetProblems.length ? `${sheetProblems.length} to check` : "OK") : "Failed"}
                </Badge>
              ) : (
                <Badge variant="muted">Not read yet</Badge>
              )}
            </div>
            <p className="text-[var(--muted-foreground)]">
              Direct and old-Airbnb-account stays from today on come in from the admin team&apos;s
              sheet every 15 minutes; the sheet decides their dates and cancellations. Write
              &quot;OWNER STAY&quot; in the comments for an owner stay.
              {sheet &&
                ` Last read ${dubaiTime.format(new Date(sheet.synced_at))}: ${sheet.created} added, ${sheet.updated} changed, ${sheet.cancelled} cancelled.`}
            </p>
            {sheetProblems.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-[var(--muted-foreground)]">
                {sheetProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {problems > 0 && (
        <div className="mb-4">
          <Callout tone="danger" title={`${problems} ${problems === 1 ? "unit has" : "units have"} a sync problem`}>
            Open the unit to see the message. A clash usually means the same nights
            were booked directly and on Airbnb.
          </Callout>
        </div>
      )}

      {units.length === 0 ? (
        <EmptyState
          title="No holiday-home units"
          description="Add your Airbnb listings to bring them in as holiday-home units, with their calendars connected."
          icon={<RefreshCw className="size-8" />}
          action={addButton ?? undefined}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead className="hidden md:table-cell">Owner</TableHead>
                  <TableHead>Airbnb link</TableHead>
                  <TableHead className="hidden sm:table-cell">Last synced</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Events</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((u) => {
                  const flags = permitted.get(u.id) ? 0 : (flagged.get(u.id) ?? 0);
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <Link href={`/units/${u.id}?tab=calendar`} className="font-medium hover:underline">
                          {u.properties?.name} · {u.unit_number}
                        </Link>
                        {flags > 0 && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--warning-foreground)] dark:text-[var(--warning)]">
                            <AlertTriangle className="size-3" />
                            {flags} Airbnb {flags === 1 ? "stay" : "stays"} without a DET permit
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {ownerOf.get(u.id) ?? (
                          <Link href={`/units/${u.id}/edit`} className="hover:underline">
                            <Badge variant="warning">No owner</Badge>
                          </Link>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.airbnb_ical_url ? <Badge variant="default">Connected</Badge> : <Badge variant="muted">Not set</Badge>}
                      </TableCell>
                      <TableCell className="tabular hidden whitespace-nowrap text-sm sm:table-cell">
                        {u.ical_last_synced_at ? dubaiTime.format(new Date(u.ical_last_synced_at)) : "—"}
                      </TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{u.ical_last_event_count ?? "—"}</TableCell>
                      <TableCell className="max-w-xs">
                        {u.airbnb_ical_url ? <SyncStatusBadge status={u.ical_last_status} /> : "—"}
                        {u.ical_last_status === "error" && u.ical_last_error && (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--destructive)]">{u.ical_last_error}</p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
