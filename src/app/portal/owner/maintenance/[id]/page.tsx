import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
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
import { ApprovalButtons } from "../approval-buttons";

export const metadata = { title: "Repair or complaint" };

/**
 * One ticket as the owner sees it: what was reported, its status and cost,
 * and the conversation with D|R|P. Internal staff notes are withheld by the
 * database, not by this page.
 */
export default async function OwnerTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const [{ id }, { sent }] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [profile, { data: t }, notesResult] = await Promise.all([
    requireRole(["owner"]),
    supabase
      .from("maintenance_requests")
      .select("*, units(unit_number, properties(name)), vendors(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("maintenance_updates")
      .select("id, author_id, note, status_from, status_to, is_internal, created_at")
      .eq("request_id", id)
      .order("created_at"),
  ]);
  if (!t) notFound();

  const waiting = t.owner_approval_required && !t.owner_approved_at && !t.owner_rejected_at;
  const cost = t.final_amount_aed ?? t.approved_amount_aed ?? t.quoted_amount_aed;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Repairs & complaints", href: "/portal/owner/maintenance" }, { label: t.ticket_number }]}
        title={t.title}
        description={`${t.ticket_number} · ${t.units?.properties?.name ?? ""} · ${t.units?.unit_number ?? ""}`}
      />

      {sent && (
        <div className="mb-5">
          <Callout tone="info" title="Sent to D|R|P">
            Your property manager has been notified. You will see every update here and in
            Notifications.
          </Callout>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <MaintenanceStatusBadge status={t.status} />
        <PriorityBadge value={t.priority} />
        <Badge variant={t.kind === "complaint" ? "brand" : "muted"}>
          {TICKET_KIND[t.kind as keyof typeof TICKET_KIND] ?? t.kind} · {MAINTENANCE_CATEGORY[t.category]}
        </Badge>
      </div>

      {waiting && (
        <Card className="mb-5 border-[var(--brand)]/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your approval is needed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm">
              The quote for this work is <Money amount={t.quoted_amount_aed} className="font-semibold" />.
              Work starts once you approve it.
            </p>
            <ApprovalButtons ticketId={t.id} quotedAmount={Number(t.quoted_amount_aed ?? 0)} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Photos</CardTitle>
            </CardHeader>
            <CardContent>
              {/* The ticket was read under the owner's own access above */}
              <TicketPhotos ticketId={t.id} photos={await ticketPhotoUrls(t.photo_paths)} canAdd canRemove={false} />
            </CardContent>
          </Card>
          <TicketNotes
            ticketId={t.id}
            staff={false}
            notes={toTicketNotes(notesResult.data ?? [], (a) => (a === profile.id ? "You" : "D|R|P"))}
          />
        </div>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldGrid columns={2}>
              <Field label="Reported">{formatDate(t.reported_at)}</Field>
              <Field label="Visit date">{t.scheduled_for ? formatDate(t.scheduled_for) : "Not yet"}</Field>
              <Field label="Contractor">{t.vendors?.name ?? "—"}</Field>
              <Field label="Cost">{cost != null ? <Money amount={cost} /> : "—"}</Field>
            </FieldGrid>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">What was reported</p>
              <p className="mt-1 whitespace-pre-line text-sm">{t.description || "—"}</p>
            </div>
            {t.resolution_notes && (
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Resolution</p>
                <p className="mt-1 whitespace-pre-line text-sm">{t.resolution_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
