"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateCompanySettings, type ActionState } from "./actions";
import type { Tables } from "@/lib/db/database.types";

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save settings"}
    </Button>
  );
}

function FormField({
  name,
  label,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; hint?: string; name: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

export function SettingsForm({ settings }: { settings: Tables<"company_settings"> }) {
  const [state, action] = useActionState<ActionState, FormData>(
    updateCompanySettings,
    {}
  );

  React.useEffect(() => {
    if (state.success) toast.success(state.success);
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Legal entity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            name="legalName"
            label="Legal name"
            defaultValue={settings.legal_name}
            required
          />
          <FormField
            name="tradeName"
            label="Trading name"
            defaultValue={settings.trade_name}
            required
          />
          <FormField
            name="tradeLicenceNumber"
            label="Trade licence number"
            defaultValue={settings.trade_licence_number ?? ""}
          />
          <FormField
            name="reraBrokerNumber"
            label="RERA broker number"
            defaultValue={settings.rera_broker_number ?? ""}
          />
          <FormField
            name="trn"
            label="TRN (VAT registration)"
            defaultValue={settings.trn ?? ""}
            hint="Printed on every invoice and owner statement."
          />
          <FormField
            name="phone"
            label="Phone"
            defaultValue={settings.phone ?? ""}
          />
          <FormField
            name="email"
            label="Email"
            type="email"
            defaultValue={settings.email ?? ""}
          />
          <FormField
            name="registeredAddress"
            label="Registered address"
            defaultValue={settings.registered_address ?? ""}
            className="sm:col-span-2"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">VAT and fees</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FormField
            name="vatRatePercent"
            label="VAT rate (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue={(Number(settings.vat_rate) * 100).toFixed(2)}
            required
            hint="Applied only to lines flagged taxable. Residential rent stays exempt."
          />
          <FormField
            name="defaultManagementFeePct"
            label="Long-term management fee (%)"
            type="number"
            step="0.01"
            defaultValue={settings.default_management_fee_pct}
            required
          />
          <FormField
            name="defaultStrManagementFeePct"
            label="Holiday home fee (%)"
            type="number"
            step="0.01"
            defaultValue={settings.default_str_management_fee_pct}
            required
          />
          <FormField
            name="maintenanceThreshold"
            label="Owner approval threshold (AED)"
            type="number"
            step="0.01"
            defaultValue={settings.maintenance_owner_approval_threshold}
            required
            hint="Maintenance quoted above this cannot start until the owner approves."
            className="sm:col-span-3"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Regulatory notice periods</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            name="rentIncreaseNoticeDays"
            label="Rent increase notice (days)"
            type="number"
            defaultValue={settings.rent_increase_notice_days}
            required
            hint="Dubai law requires 90 days' written notice before a rent increase takes effect."
          />
          <FormField
            name="leaseRenewalNoticeDays"
            label="Renewal / non-renewal notice (days)"
            type="number"
            defaultValue={settings.lease_renewal_notice_days}
            required
          />
          <FormField
            name="ejariOccupantUpdateDays"
            label="Ejari occupant update window (days)"
            type="number"
            defaultValue={settings.ejari_occupant_update_days}
            required
            hint="Since 2026, occupant changes must be reflected in Ejari within 30 days."
          />
          <FormField
            name="permitRenewalReminderDays"
            label="DET permit reminder (days before expiry)"
            type="number"
            defaultValue={settings.permit_renewal_reminder_days}
            required
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Booking emails and owners</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="emailOwnersAboutBookings"
              defaultChecked={settings.email_owners_about_bookings}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">Email owners about their bookings</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                New, moved and cancelled stays. Off: owners see these only in their portal, and
                nothing is emailed to them.
              </span>
            </span>
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="emailOfficeAboutBookings"
              defaultChecked={settings.email_office_about_bookings}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">Email the office about bookings</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                New, moved and cancelled stays, sent to the company email above. Off: staff see
                these only as portal notifications. Nothing is ever emailed to
                office@dubairapidproperties.com.
              </span>
            </span>
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="showGuestFirstNameToOwners"
              defaultChecked={settings.show_guest_first_name_to_owners}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">Show owners the guest&apos;s first name</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                On their bookings and calendar. Off: owners see dates, nights and guest numbers
                only. Surnames, contact details and prices are never shown.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Save />
      </div>
    </form>
  );
}
