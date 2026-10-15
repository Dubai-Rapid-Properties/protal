import Link from "next/link";
import { notFound } from "next/navigation";
import { EyeOff, MessageSquare } from "lucide-react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Field, FieldGrid, Money, PageHeader } from "@/components/domain/shared";
import { IncidentStatusBadge } from "@/components/domain/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import { INCIDENT_CATEGORY, type IncidentCategory } from "@/lib/labels";
import { BUCKETS, storage } from "@/lib/storage";
import { MAX_INCIDENT_PHOTOS, incidentStatusChange } from "@/lib/incidents";
import { IncidentOutcome, IncidentPhotos, IncidentStatus, IncidentTimeline, type IncidentEntry } from "./incident-panel";

export const metadata = { title: "Guest incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [profile, { data: incident }, { data: updates }] = await Promise.all([
    requireCapability("incidents.view"),
    supabase
      .from("guest_incidents")
      .select(
        "*, units(id, unit_number, properties(name)), bookings(id, booking_number, check_in, check_out, channel, guests(full_name)), reporter:profiles!guest_incidents_reported_by_fkey(full_name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("guest_incident_updates")
      .select("id, note, status_from, status_to, created_at, author:profiles!guest_incident_updates_author_id_fkey(full_name)")
      .eq("incident_id", id)
      .order("created_at"),
  ]);
  if (!incident) notFound();

  // The timeline starts with the report itself.
  const entries: IncidentEntry[] = [
    {
      id: "reported",
      author: incident.reporter?.full_name || "Someone",
      when: formatDateTime(incident.created_at),
      change: "Reported",
      note: null,
    },
    ...(updates ?? []).map((u) => ({
      id: u.id,
      author: u.author?.full_name || "Someone",
      when: formatDateTime(u.created_at),
      change: u.status_to ? incidentStatusChange(u.status_from, u.status_to) : null,
      note: u.note,
    })),
  ];

  // Short-lived links: the bucket is private and these photos are staff only.
  const photos = await Promise.all(
    incident.photo_paths.map(async (path) => ({
      path,
      url: await storage.signedUrl(BUCKETS.documents, path, 600).catch(() => null),
    }))
  );

  const category = INCIDENT_CATEGORY[incident.category as IncidentCategory] ?? incident.category;
  const unitLabel = `${incident.units?.properties?.name ?? ""} · ${incident.units?.unit_number ?? ""}`;
  const canEdit = can(profile.role, "incidents.report");
  const b = incident.bookings;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Guest incidents", href: "/incidents" }, { label: category }]}
        title={category}
        description={`${unitLabel} · ${formatDate(incident.occurred_on)}`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <IncidentStatusBadge status={incident.status} />
        <span className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
          <EyeOff className="size-4" />
          Staff only - not shown to the owner
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What happened</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-line text-sm">{incident.description}</p>
            <FieldGrid columns={2}>
              <Field label="Unit">
                <Link href={`/units/${incident.unit_id}`} className="hover:underline">
                  {unitLabel}
                </Link>
              </Field>
              <Field label="Guest stay">
                {b ? (
                  <Link href={`/bookings/${b.id}`} className="hover:underline">
                    {b.guests?.full_name ?? "Guest"} · {formatDate(b.check_in)} → {formatDate(b.check_out)}
                    <span className="block text-xs text-[var(--muted-foreground)]">{b.booking_number}</span>
                  </Link>
                ) : (
                  "Not linked to a stay"
                )}
              </Field>
              <Field label="Date found">{formatDate(incident.occurred_on)}</Field>
              <Field label="Reported by">
                {incident.reporter?.full_name ?? "—"}
                <span className="block text-xs text-[var(--muted-foreground)]">
                  {formatDateTime(incident.created_at)}
                </span>
              </Field>
              <Field label="Charge to the guest">
                {incident.charge_aed != null ? <Money amount={incident.charge_aed} /> : "—"}
              </Field>
              {incident.resolved_at && <Field label="Finished">{formatDateTime(incident.resolved_at)}</Field>}
            </FieldGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4" />
              Comments and status changes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <IncidentTimeline incidentId={incident.id} entries={entries} canComment={canEdit} />
          </CardContent>
        </Card>
        </div>

        <div className="space-y-5">
          {canEdit && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Status</CardTitle>
              </CardHeader>
              <CardContent>
                <IncidentStatus incidentId={incident.id} status={incident.status} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Charge and outcome</CardTitle>
            </CardHeader>
            <CardContent>
              {canEdit ? (
                <IncidentOutcome
                  incidentId={incident.id}
                  chargeAed={incident.charge_aed}
                  resolution={incident.resolution}
                />
              ) : (
                <p className="whitespace-pre-line text-sm">{incident.resolution || "Nothing recorded yet."}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Photos</CardTitle>
          </CardHeader>
          <CardContent>
            <IncidentPhotos
              incidentId={incident.id}
              photos={photos}
              canAdd={canEdit && photos.length < MAX_INCIDENT_PHOTOS}
              canRemove={profile.role === "super_admin"}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
