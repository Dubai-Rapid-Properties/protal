"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormError, SelectField, SubmitBar, TextAreaField, TextField } from "@/components/domain/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { optionsFrom } from "@/lib/labels";
import { LEAD_INTENTS, LEAD_STAGES } from "@/lib/leads";
import { deleteLead, updateLead, type ActionState } from "../actions";

/** Stage, owner and follow-up for one lead. */
export function LeadPanel({
  leadId,
  leadName,
  staff,
  current,
}: {
  leadId: string;
  leadName: string;
  staff: { id: string; name: string }[];
  current: {
    stage: string;
    intent: string;
    assignedTo: string | null;
    followUp: string | null;
    lostReason: string | null;
    notes: string | null;
  };
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateLead.bind(null, leadId), {});
  const [stage, setStage] = React.useState(current.stage);
  const [deleting, startDelete] = React.useTransition();
  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Follow-up</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3">
          <FormError message={state.error} />
          <SelectField
            name="stage"
            label="Stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            options={optionsFrom(LEAD_STAGES)}
          />
          {stage === "lost" && (
            <TextField name="lostReason" label="Why it was lost" required defaultValue={current.lostReason ?? ""} />
          )}
          <SelectField name="intent" label="Interested in" defaultValue={current.intent} options={optionsFrom(LEAD_INTENTS)} />
          <SelectField
            name="assignedTo"
            label="Assigned to"
            defaultValue={current.assignedTo ?? ""}
            placeholder="Nobody yet"
            options={staff.map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField name="followUp" label="Next follow-up" type="date" defaultValue={current.followUp ?? ""} />
          <TextAreaField name="notes" label="Notes" rows={4} maxLength={5000} defaultValue={current.notes ?? ""} />
          <TextAreaField name="note" label="Add to the timeline (optional)" rows={2} maxLength={2000} placeholder="e.g. Called, sending options by WhatsApp" />
          <SubmitBar label="Save" pendingLabel="Saving…" />
        </form>
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={deleting}
            className="-ml-2 text-[var(--destructive)]"
            onClick={() => {
              if (!window.confirm(`Delete the lead from ${leadName}? Its notes and timeline go too. This cannot be undone.`)) return;
              startDelete(async () => {
                const result = await deleteLead(leadId);
                if (result?.error) toast.error(result.error);
              });
            }}
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Delete lead
          </Button>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            For tests and spam. A real enquiry that went nowhere is better set to Lost, so it stays in the history.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
