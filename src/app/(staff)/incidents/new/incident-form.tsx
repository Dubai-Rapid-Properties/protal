"use client";

import * as React from "react";
import { useActionState } from "react";
import { FormError, FormSection, SelectField, SubmitBar, TextAreaField, TextField } from "@/components/domain/form";
import { INCIDENT_CATEGORY, optionsFrom } from "@/lib/labels";
import { createIncident, type ActionState } from "../actions";

export interface BookingOption {
  id: string;
  unitId: string;
  label: string;
}

export function IncidentForm({
  units,
  bookings,
  defaultUnitId,
  defaultBookingId,
  today,
}: {
  units: { id: string; label: string }[];
  bookings: BookingOption[];
  defaultUnitId?: string;
  defaultBookingId?: string;
  today: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createIncident, {});
  const [unitId, setUnitId] = React.useState(
    units.some((u) => u.id === defaultUnitId) ? defaultUnitId! : ""
  );
  const unitBookings = bookings.filter((b) => b.unitId === unitId);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      <FormSection title="Where and who">
        <SelectField
          name="unitId"
          label="Unit"
          required
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          placeholder="Choose the unit"
          options={units.map((u) => ({ value: u.id, label: u.label }))}
        />
        <SelectField
          key={unitId}
          name="bookingId"
          label="Guest stay"
          defaultValue={unitBookings.some((b) => b.id === defaultBookingId) ? defaultBookingId : ""}
          placeholder={unitId ? (unitBookings.length ? "Not linked to a stay" : "No recent stays on this unit") : "Choose the unit first"}
          options={unitBookings.map((b) => ({ value: b.id, label: b.label }))}
          disabled={!unitId || unitBookings.length === 0}
          hint="Stays from the last 60 days."
        />
      </FormSection>
      <FormSection title="What happened">
        <SelectField
          name="category"
          label="Type"
          required
          defaultValue=""
          placeholder="Choose what happened"
          options={optionsFrom(INCIDENT_CATEGORY)}
        />
        <TextField name="occurredOn" label="Date found" type="date" required defaultValue={today} max={today} />
        <TextAreaField
          name="description"
          label="Description"
          required
          rows={4}
          placeholder="e.g. Guest was sick on the bedroom carpet; deep clean needed."
        />
        <TextField
          name="chargeAed"
          label="Charge to the guest (AED)"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          hint="Cleaning or repair cost to recover from the guest or their deposit, if any."
        />
      </FormSection>
      <p className="text-sm text-[var(--muted-foreground)]">You can add photos on the next screen.</p>
      <SubmitBar label="Save incident" pendingLabel="Saving…" cancelHref="/incidents" />
    </form>
  );
}
