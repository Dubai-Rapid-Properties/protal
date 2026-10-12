import Link from "next/link";
import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Callout, Field, FieldGrid, Money, PageHeader } from "@/components/domain/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge, ChannelBadge } from "@/components/domain/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { INCIDENT_CATEGORY, SALES_CHANNEL, type IncidentCategory } from "@/lib/labels";
import { BookingActions, DeleteBookingButton } from "./booking-actions";
import { GuestDialog } from "./guest-dialog";
import { PriceDialog } from "./price-dialog";

export const metadata = { title: "Booking" };

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ price?: string }>;
}) {
  const { id } = await params;
  const { price } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [profile, { data: b }] = await Promise.all([
    requireCapability("bookings.view"),
    supabase
      .from("bookings")
      .select(
        "*, guests(id, full_name, email, phone, nationality, passport_number), units(id, unit_number, airbnb_ical_url, properties(name))"
      )
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (!b) notFound();
  const canSeeIncidents = can(profile.role, "incidents.view");
  const [{ data: unitOwner }, { data: incidents }] = await Promise.all([
    supabase.from("v_units_overview").select("owner_id, owner_name").eq("id", b.unit_id).maybeSingle(),
    canSeeIncidents
      ? supabase
          .from("guest_incidents")
          .select("id, occurred_on, category, description, charge_aed, status")
          .eq("booking_id", b.id)
          .order("occurred_on", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);

  const unitLabel = `${b.units?.properties?.name ?? ""} · ${b.units?.unit_number ?? ""}`;
  // Airbnb's calendar feed carries no guest count; imports store a placeholder.
  const guestCount = !b.guest_count_known ? "Not provided by Airbnb's calendar" : [
    `${b.adults} adult${b.adults === 1 ? "" : "s"}`,
    b.children ? `${b.children} child${b.children === 1 ? "" : "ren"}` : null,
    b.infants ? `${b.infants} infant${b.infants === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Bookings", href: "/bookings" }, { label: b.booking_number }]}
        title={b.guests?.full_name ?? b.booking_number}
        description={`${b.booking_number} · ${unitLabel}`}
        actions={
          <>
            {can(profile.role, "bookings.manage") && <BookingActions bookingId={b.id} status={b.status} />}
            {profile.role === "super_admin" && (
              <DeleteBookingButton
                bookingId={b.id}
                bookingNumber={b.booking_number}
                reimported={Boolean(b.ical_uid && b.units?.airbnb_ical_url)}
              />
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <BookingStatusBadge status={b.status} />
        <ChannelBadge channel={b.channel} />
        {b.ical_uid && <Badge variant="muted">Synced from Airbnb calendar</Badge>}
      </div>

      {b.imported_without_permit && b.status !== "cancelled" && (
        <div className="mb-5">
          <Callout tone="danger" title="Imported without a valid DET permit">
            This Airbnb reservation was recorded so its nights stay blocked, but the unit
            had no valid DET permit for the check-in date. Add or renew the permit before
            the guest arrives.
          </Callout>
        </div>
      )}

      {b.status === "cancelled" && (
        <div className="mb-5">
          <Callout tone="warning" title={`Cancelled on ${formatDate(b.cancelled_on)}`}>
            {b.cancellation_reason || "No reason recorded."}
          </Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Stay</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid columns={2}>
              <Field label="Unit">
                {b.units ? (
                  <Link href={`/units/${b.units.id}`} className="hover:underline">
                    {unitLabel}
                  </Link>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Owner">
                {unitOwner?.owner_id ? (
                  <Link href={`/owners/${unitOwner.owner_id}`} className="hover:underline">
                    {unitOwner.owner_name}
                  </Link>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Nights">{b.nights}</Field>
              <Field label="Check-in">{formatDate(b.check_in)}</Field>
              <Field label="Check-out">{formatDate(b.check_out)}</Field>
              <Field label="Guests">{guestCount}</Field>
              <Field label="Channel">
                {SALES_CHANNEL[b.channel]}
                {b.external_booking_id && ` · ${b.external_booking_id}`}
              </Field>
              <Field label="DET permit at booking">{b.permit_number_at_booking ?? "—"}</Field>
            </FieldGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Guest</CardTitle>
            {can(profile.role, "bookings.manage") && (
              <GuestDialog bookingId={b.id} isAirbnb={b.channel === "airbnb"} guest={b.guests} />
            )}
          </CardHeader>
          <CardContent>
            <FieldGrid columns={2}>
              <Field label="Name">{b.guests?.full_name ?? "—"}</Field>
              <Field label="Phone">{b.guests?.phone ?? "—"}</Field>
              <Field label="Email">{b.guests?.email ?? "—"}</Field>
              <Field label="Nationality">{b.guests?.nationality ?? "—"}</Field>
              <Field label="Passport">{b.guests?.passport_number ?? "—"}</Field>
            </FieldGrid>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Price</CardTitle>
            {can(profile.role, "bookings.manage") && (
              <PriceDialog
                bookingId={b.id}
                isAirbnb={b.channel === "airbnb"}
                needsGuest={!b.guests}
                priced={Number(b.gross_total_aed) > 0 || Number(b.payout_expected_aed) > 0}
                defaultOpen={price === "1"}
                current={{
                  accommodation: Number(b.accommodation_aed),
                  cleaning: Number(b.cleaning_fee_aed),
                  extra: Number(b.extra_fees_aed),
                  tourism: Number(b.tourism_dirham_aed),
                  commission: Number(b.channel_commission_aed),
                  payout: Number(b.payout_expected_aed),
                }}
              />
            )}
          </CardHeader>
          <CardContent>
            <FieldGrid columns={3}>
              <Field label="Nightly rate"><Money amount={b.nightly_rate_aed} /></Field>
              <Field label="Accommodation"><Money amount={b.accommodation_aed} /></Field>
              <Field label="Cleaning fee"><Money amount={b.cleaning_fee_aed} /></Field>
              <Field label="Other fees"><Money amount={b.extra_fees_aed} /></Field>
              <Field label="Tourism Dirham"><Money amount={b.tourism_dirham_aed} /></Field>
              <Field label="Channel commission"><Money amount={b.channel_commission_aed} /></Field>
              <Field label="Guest pays">
                {/* Priced with the Airbnb payout alone: the guest total is not known yet. */}
                {Number(b.gross_total_aed) > 0 || !Number(b.payout_expected_aed) ? (
                  <Money amount={b.gross_total_aed} className="font-semibold" />
                ) : (
                  "—"
                )}
              </Field>
              <Field label={b.channel === "airbnb" ? 'Payout (Airbnb "Amount")' : "Expected payout"}>
                <Money amount={b.payout_expected_aed} />
              </Field>
              <Field label="Damage deposit"><Money amount={b.damage_deposit_aed} /></Field>
            </FieldGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">From the guest</p>
              <p className="whitespace-pre-line">{b.guest_message || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Internal</p>
              <p className="whitespace-pre-line">{b.internal_notes || "—"}</p>
            </div>
          </CardContent>
        </Card>

        {canSeeIncidents && (
          <Card className="lg:col-span-3">
            <CardHeader className="flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Guest incidents</CardTitle>
                <p className="text-xs text-[var(--muted-foreground)]">Mess, damage, smoking ... Staff only, never shown to the owner.</p>
              </div>
              {can(profile.role, "incidents.report") && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/incidents/new?booking=${b.id}`}>
                    <Plus className="size-4" />
                    Report incident
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent className="text-sm">
              {!incidents?.length ? (
                <p className="text-[var(--muted-foreground)]">None reported for this stay.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {incidents.map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/incidents/${i.id}`} className="font-medium hover:underline">
                          {INCIDENT_CATEGORY[i.category as IncidentCategory] ?? i.category}
                        </Link>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {formatDate(i.occurred_on)} · {i.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {i.charge_aed != null && <Money amount={i.charge_aed} />}
                        <Badge variant={i.status === "open" ? "warning" : "muted"}>
                          {i.status === "open" ? "Open" : "Resolved"}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
