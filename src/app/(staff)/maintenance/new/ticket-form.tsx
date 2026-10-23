"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormError, FormSection, SelectField, SubmitBar } from "@/components/domain/form";
import { TicketFields } from "@/components/domain/ticket-fields";
import { PhotoChooser, uploadTicketPhotos } from "@/components/domain/ticket-photos";
import type { TicketKind } from "@/lib/labels";
import { createTicket, type ActionState } from "../actions";

const REPORTED_BY = [
  { value: "tenant", label: "Tenant" },
  { value: "guest", label: "Holiday home guest" },
  { value: "owner", label: "Owner" },
  { value: "staff", label: "D|R|P staff (found it ourselves)" },
];

export function TicketForm({
  units,
  defaultUnitId,
  defaultKind,
}: {
  units: { id: string; label: string }[];
  defaultUnitId?: string;
  defaultKind: TicketKind;
}) {
  const router = useRouter();
  const [state, action] = useActionState<ActionState, FormData>(createTicket, {});
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);

  // The ticket exists: send its photos, then open it.
  React.useEffect(() => {
    if (!state.id) return;
    const id = state.id;
    (async () => {
      if (photos.length) {
        setUploading(true);
        const added = await uploadTicketPhotos(id, photos);
        if (added < photos.length) toast.warning("Ticket created. Add the missing photos on its page.");
      }
      router.push(`/maintenance/${id}`);
    })();
    // Only when a new ticket id arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.id]);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      <FormSection title="Where and who">
        <SelectField
          name="unitId"
          label="Unit"
          required
          defaultValue={units.some((u) => u.id === defaultUnitId) ? defaultUnitId : ""}
          placeholder="Choose the unit"
          options={units.map((u) => ({ value: u.id, label: u.label }))}
        />
        <SelectField name="reportedBy" label="Reported by" required defaultValue="tenant" options={REPORTED_BY} />
      </FormSection>
      <FormSection title="The issue">
        <TicketFields defaultKind={defaultKind} />
      </FormSection>
      <FormSection title="Photos" description="Photos of the problem help whoever fixes it." columns={1}>
        <PhotoChooser files={photos} onChange={setPhotos} disabled={uploading || Boolean(state.id)} />
      </FormSection>
      <SubmitBar
        label={uploading ? "Uploading photos…" : "Create ticket"}
        pendingLabel="Creating…"
        cancelHref="/maintenance"
      />
    </form>
  );
}
