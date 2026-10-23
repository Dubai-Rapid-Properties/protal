"use client";

import * as React from "react";
import { useActionState } from "react";
import { CheckCircle2, Printer, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  approveAndSendStatement,
  deleteStatement,
  returnStatement,
  submitStatement,
  updateStatementStatus,
  type ActionState,
} from "../../actions";
import type { Enums } from "@/lib/db/database.types";

/**
 * The next step a statement can take, given where it is (0060): the office
 * sends a draft for approval; the approver approves it, which emails it to
 * the owner, or sends it back; then it is marked paid.
 */
const PAYABLE: Enums<"statement_status">[] = ["issued", "approved"];

export function StatementActions({
  statementId,
  status,
  submitted,
  ownerEmail,
  canIssue,
  canApprove,
  canDelete = false,
}: {
  statementId: string;
  status: Enums<"statement_status">;
  /** Waiting for the approver. */
  submitted: boolean;
  ownerEmail: string | null;
  canIssue: boolean;
  canApprove: boolean;
  /** dulshan@dubairapidproperties.com only (0054). */
  canDelete?: boolean;
}) {
  const [deleting, startDelete] = React.useTransition();
  const [working, startWork] = React.useTransition();
  const run = (step: () => Promise<ActionState>) =>
    startWork(async () => {
      const result = await step();
      if (result?.error) toast.error(result.error);
      if (result?.success) toast.success(result.success);
    });
  const [state, action] = useActionState<ActionState, FormData>(
    updateStatementStatus,
    {}
  );

  React.useEffect(() => {
    if (state.success) toast.success(state.success);
    if (state.error) toast.error(state.error);
  }, [state]);


  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => window.print()}>
        <Printer className="size-4" />
        Print / save PDF
      </Button>

      {canIssue && status === "draft" && !submitted && (
        <Button disabled={working} onClick={() => run(() => submitStatement(statementId))}>
          <Send className="size-4" />
          Send for approval
        </Button>
      )}

      {canApprove && status === "draft" && submitted && (
        <>
          <Button
            disabled={working}
            onClick={() => {
              if (!ownerEmail) {
                toast.error("The owner has no email address. Add it on the owner's page, then approve.");
                return;
              }
              if (!window.confirm(`Approve this statement and email it to ${ownerEmail}?`)) return;
              run(() => approveAndSendStatement(statementId));
            }}
          >
            <CheckCircle2 className="size-4" />
            Approve and send to owner
          </Button>
          <Button
            variant="outline"
            disabled={working}
            onClick={() => {
              const note = window.prompt("Send back to the office. What should change?");
              if (note === null) return;
              run(() => returnStatement(statementId, note));
            }}
          >
            <Undo2 className="size-4" />
            Send back
          </Button>
        </>
      )}

      {canIssue && PAYABLE.includes(status) && (
        <form action={action}>
          <input type="hidden" name="statementId" value={statementId} />
          <input type="hidden" name="status" value="paid" />
          <Button type="submit">Mark paid</Button>
        </form>
      )}

      {canIssue && status !== "void" && status !== "paid" && (
        <form action={action}>
          <input type="hidden" name="statementId" value={statementId} />
          <input type="hidden" name="status" value="void" />
          <Button type="submit" variant="ghost">
            Void
          </Button>
        </form>
      )}

      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          disabled={deleting}
          onClick={() => {
            if (!window.confirm("Delete this statement? It is removed completely, and its income can go on a new statement.")) return;
            startDelete(async () => {
              const result = await deleteStatement(statementId);
              if (result?.error) toast.error(result.error);
            });
          }}
        >
          <Trash2 className="size-4" />
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      )}
    </div>
  );
}
