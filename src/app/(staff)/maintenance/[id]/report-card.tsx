"use client";

import * as React from "react";
import { useActionState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { FormError, SelectField, SubmitBar, TextField } from "@/components/domain/form";
import { TicketFields } from "@/components/domain/ticket-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TicketKind } from "@/lib/labels";
import { updateTicketReport, type ActionState } from "../actions";

const REPORTED_BY = [
  { value: "tenant", label: "Tenant" },
  { value: "guest", label: "Holiday home guest" },
  { value: "owner", label: "Owner" },
  { value: "staff", label: "D|R|P staff (found it ourselves)" },
];

/**
 * The ticket's Details card. Staff who handle tickets can switch it to a form
 * and correct anything that was reported: unit, who reported it and when,
 * type, category, title, details and access notes. Each edit is noted on the
 * timeline (internal).
 */
export function ReportCard({
  ticketId,
  canEdit,
  units,
  current,
  children,
}: {
  ticketId: string;
  canEdit: boolean;
  units: { id: string; label: string }[];
  current: {
    unitId: string;
    reportedBy: string;
    reportedOn: string;
    kind: TicketKind;
    category: string;
    title: string;
    description: string | null;
    accessNotes: string | null;
  };
  /** The details as read */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [state, action] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await updateTicketReport(ticketId, prev, formData);
    if (result.success) {
      toast.success(result.success);
      setEditing(false);
    }
    return result;
  }, {});

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">{editing ? "Edit details" : "Details"}</CardTitle>
        {canEdit && !editing && (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form action={action} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormError message={state.error} />
            </div>
            <SelectField
              name="unitId"
              label="Unit"
              required
              wide
              defaultValue={current.unitId}
              options={units.map((u) => ({ value: u.id, label: u.label }))}
            />
            <SelectField name="reportedBy" label="Reported by" required defaultValue={current.reportedBy} options={REPORTED_BY} />
            <TextField name="reportedOn" label="Reported on" type="date" required defaultValue={current.reportedOn} />
            <TicketFields
              defaultKind={current.kind}
              showPriority={false}
              defaults={{
                category: current.category,
                title: current.title,
                description: current.description,
                accessNotes: current.accessNotes,
              }}
            />
            <div className="flex items-center justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <SubmitBar label="Save changes" pendingLabel="Saving…" />
            </div>
          </form>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
