import Link from "next/link";
import { notFound } from "next/navigation";
import { EyeOff } from "lucide-react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Field, FieldGrid, Money, PageHeader } from "@/components/domain/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import { INCIDENT_CATEGORY, INCIDENT_STATUS, type IncidentCategory } from "@/lib/labels";
import { BUCKETS, storage } from "@/lib/storage";
import { MAX_INCIDENT_PHOTOS } from "@/lib/incidents";
import { IncidentOutcome, IncidentPhotos } from "./incident-panel";

export const metadata = { title: "Guest incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [profile, { data: incident }] = await Promise.all([
    requireCapability("incidents.view"),
    supabase
      .from("guest_incidents")
      .select(
        "*, units(id, unit_number, properties(name)), bookings(id, booking_number, check_in, check_out, channel, guests(full_name)), reporter:profiles!guest_incidents_reported_by_fkey(full_name)"
      )
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (!incident) notFound();

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
        <Badge variant={incident.status === "open" ? "warning" : "muted"}>
          {INCIDENT_STATUS[incident.status as keyof typeof INCIDENT_STATUS] ?? incident.status}
        </Badge>
        <span className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
          <EyeOff className="size-4" />
          Staff only - not shown to the owner
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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
              {incident.resolved_at && <Field label="Resolved">{formatDateTime(incident.resolved_at)}</Field>}
            </FieldGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Outcome</CardTitle>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <IncidentOutcome
                incidentId={incident.id}
                status={incident.status}
                chargeAed={incident.charge_aed}
                resolution={incident.resolution}
              />
            ) : (
              <p className="whitespace-pre-line text-sm">{incident.resolution || "Nothing recorded yet."}</p>
            )}
          </CardContent>
        </Card>

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
