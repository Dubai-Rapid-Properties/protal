import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Callout, Field, FieldGrid, Money, PageHeader } from "@/components/domain/shared";
import { MaintenanceStatusBadge, PriorityBadge } from "@/components/domain/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TicketNotes } from "@/components/domain/ticket-notes";
import { TicketPhotos } from "@/components/domain/ticket-photos";
import { ticketPhotoUrls } from "@/lib/tickets/photo-urls";
import { formatDate } from "@/lib/dates";
import { MAINTENANCE_CATEGORY, TICKET_KIND } from "@/lib/labels";
import { toTicketNotes } from "@/lib/tickets/notes";
import { DetailsCard, StatusCard } from "./ticket-panel";
import { DeleteTicketButton } from "./delete-ticket";
import { OwnerContactCard } from "./owner-contact";
import { OWNER_CONTACT_EVERY_HOURS } from "@/lib/tickets/owner-contact";
import { env } from "@/lib/env";

export const metadata = { title: "Ticket" };

const REPORTED_BY: Record<string, string> = {
  owner: "the owner",
  tenant: "the tenant",
  guest: "a guest",
  staff: "D|R|P staff",
};

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [profile, { data: t }, notesResult, staffResult] = await Promise.all([
    requireCapability("maintenance.view"),
    supabase
      .from("maintenance_requests")
      .select(
        "*, units(id, unit_number, properties(name)), raiser:profiles!maintenance_requests_raised_by_fkey(full_name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("maintenance_updates")
      .select("id, author_id, note, status_from, status_to, is_internal, created_at")
      .eq("request_id", id)
      .order("created_at"),
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .in("role", ["super_admin", "property_manager", "agent", "maintenance"])
      .eq("is_active", true)
      .order("full_name"),
  ]);
  if (!t) notFound();

  const people = new Map((staffResult.data ?? []).map((p) => [p.id, p.full_name || p.email || "Staff"]));
  const noteRows = notesResult.data ?? [];
  // Owners appear in the timeline too; look up any author not on staff.
  const others = [...new Set(noteRows.map((n) => n.author_id).filter((a): a is string => !!a && !people.has(a)))];
  if (others.length) {
    const { data } = await supabase.from("profiles").select("id, full_name, email, role").in("id", others);
    for (const p of data ?? []) {
      people.set(p.id, `${p.full_name || p.email}${p.role === "owner" ? " (owner)" : ""}`);
    }
  }

  // The unit's owners, to call about the ticket (0065).
  const { data: ownerships } = t.owner_contact
    ? await supabase
        .from("unit_ownerships")
        .select("is_primary_contact, owners(full_name, phone, whatsapp, email)")
        .eq("unit_id", t.unit_id)
        .is("end_date", null)
        .order("is_primary_contact", { ascending: false })
    : { data: [] };
  const ownersToCall = (ownerships ?? [])
    .map((o) => o.owners)
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => ({ name: o.full_name, phone: o.phone || o.whatsapp, email: o.email }));
  const contactedBy = t.owner_contacted_by ? people.get(t.owner_contacted_by) ?? "staff" : "staff";
  const contactedLine = t.owner_contacted_at
    ? `By ${contactedBy} on ${new Date(t.owner_contacted_at).toLocaleString("en-GB", {
        timeZone: "Asia/Dubai",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}.`
    : null;

  const unitLabel = `${t.units?.properties?.name ?? ""} · ${t.units?.unit_number ?? ""}`;
  const canManage = can(profile.role, "maintenance.assign");
  const waitingOwner = t.owner_approval_required && !t.owner_approved_at && !t.owner_rejected_at;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Repairs & complaints", href: "/maintenance" }, { label: t.ticket_number }]}
        title={t.title}
        description={`${t.ticket_number} · ${unitLabel}`}
        actions={
          (profile.role === "super_admin" || profile.role === "property_manager") && (
            <DeleteTicketButton ticketId={t.id} ticketNumber={t.ticket_number} />
          )
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <MaintenanceStatusBadge status={t.status} />
        <PriorityBadge value={t.priority} />
        <Badge variant={t.kind === "complaint" ? "brand" : "muted"}>
          {TICKET_KIND[t.kind as keyof typeof TICKET_KIND] ?? t.kind} · {MAINTENANCE_CATEGORY[t.category]}
        </Badge>
      </div>

      {waitingOwner && (
        <div className="mb-5">
          <Callout tone="warning" title="Waiting for the owner's approval">
            The quote is above the approval limit. The owner approves or declines it in
            their portal; work cannot be scheduled until then.
          </Callout>
        </div>
      )}
      {t.owner_rejected_at && (
        <div className="mb-5">
          <Callout tone="danger" title={`Declined by the owner on ${formatDate(t.owner_rejected_at)}`}>
            {t.owner_rejection_reason || "No reason given."}
          </Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGrid columns={2}>
                <Field label="Unit">
                  {t.units ? (
                    <Link href={`/units/${t.units.id}`} className="hover:underline">
                      {unitLabel}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label="Reported">
                  {formatDate(t.reported_at)} by {REPORTED_BY[t.raised_by_kind] ?? t.raised_by_kind}
                  {t.raiser?.full_name ? ` (${t.raiser.full_name})` : ""}
                </Field>
                <Field label="Assigned to">{(t.assigned_to && people.get(t.assigned_to)) || "—"}</Field>
                <Field label="Visit date">{t.scheduled_for ? formatDate(t.scheduled_for) : "—"}</Field>
                <Field label="Quote"><Money amount={t.quoted_amount_aed} /></Field>
                <Field label="Final cost"><Money amount={t.final_amount_aed} /></Field>
              </FieldGrid>
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">What was reported</p>
                <p className="mt-1 whitespace-pre-line text-sm">{t.description || "—"}</p>
              </div>
              {t.access_notes && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Access</p>
                  <p className="mt-1 whitespace-pre-line text-sm">{t.access_notes}</p>
                </div>
              )}
              {t.resolution_notes && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Resolution</p>
                  <p className="mt-1 whitespace-pre-line text-sm">{t.resolution_notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Photos</CardTitle>
            </CardHeader>
            <CardContent>
              <TicketPhotos
                ticketId={t.id}
                photos={await ticketPhotoUrls(t.photo_paths)}
                canAdd={can(profile.role, "maintenance.raise")}
                canRemove={profile.role === "super_admin"}
              />
            </CardContent>
          </Card>

          <TicketNotes
            ticketId={t.id}
            staff
            notes={toTicketNotes(noteRows, (a) => (a && people.get(a)) || "Someone")}
          />
        </div>

        {(canManage || t.owner_contact) && (
          <div className="space-y-5">
            {t.owner_contact && (
              <OwnerContactCard
                ticketId={t.id}
                contacted={t.owner_contact === "contacted"}
                contactedLine={contactedLine}
                reminders={t.owner_reminders_sent}
                owners={ownersToCall}
                canMark={canManage}
                everyHours={OWNER_CONTACT_EVERY_HOURS}
                inbox={env.operationsEmail}
              />
            )}
            {canManage && <StatusCard ticketId={t.id} status={t.status} />}
            {canManage && (
              <DetailsCard
                ticketId={t.id}
                staff={[...(staffResult.data ?? [])].map((p) => ({ id: p.id, name: p.full_name || p.email || "Staff" }))}
                current={{
                  priority: t.priority,
                  assignedTo: t.assigned_to,
                  scheduledFor: t.scheduled_for ? t.scheduled_for.slice(0, 10) : null,
                  quoted: t.quoted_amount_aed,
                  final: t.final_amount_aed,
                  costBorneBy: t.cost_borne_by,
                  resolution: t.resolution_notes,
                }}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
