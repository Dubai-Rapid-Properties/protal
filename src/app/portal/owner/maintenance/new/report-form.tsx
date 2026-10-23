"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormError, FormSection, SelectField, SubmitBar } from "@/components/domain/form";
import { TicketFields } from "@/components/domain/ticket-fields";
import { PhotoChooser, uploadTicketPhotos } from "@/components/domain/ticket-photos";
import { reportIssue, type ActionState } from "../actions";

export function ReportForm({
  units,
  defaultUnitId,
}: {
  units: { id: string; label: string }[];
  defaultUnitId?: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState<ActionState, FormData>(reportIssue, {});
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const only = units.length === 1 ? units[0].id : undefined;

  // The report is in: send its photos, then open it.
  React.useEffect(() => {
    if (!state.id) return;
    const id = state.id;
    (async () => {
      if (photos.length) {
        setUploading(true);
        const added = await uploadTicketPhotos(id, photos);
        if (added < photos.length) toast.warning("Report sent. Add the missing photos on its page.");
      }
      router.push(`/portal/owner/maintenance/${id}?sent=1`);
    })();
    // Only when a new ticket id arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.id]);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      <FormSection title="Which property">
        <SelectField
          name="unitId"
          label="Property"
          required
          wide
          defaultValue={only ?? (units.some((u) => u.id === defaultUnitId) ? defaultUnitId : "")}
          placeholder={only ? undefined : "Choose the property"}
          options={units.map((u) => ({ value: u.id, label: u.label }))}
        />
      </FormSection>
      <FormSection title="What is the issue">
        <TicketFields />
      </FormSection>
      <FormSection title="Photos" description="Photos of the problem help us fix it faster." columns={1}>
        <PhotoChooser files={photos} onChange={setPhotos} disabled={uploading || Boolean(state.id)} />
      </FormSection>
      <SubmitBar
        label={uploading ? "Uploading photos…" : "Send to D|R|P"}
        pendingLabel="Sending…"
        cancelHref="/portal/owner/maintenance"
      />
    </form>
  );
}
