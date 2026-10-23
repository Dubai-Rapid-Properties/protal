"use client";

import * as React from "react";
import { useActionState } from "react";
import { Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteStatement, updateStatementStatus, type ActionState } from "../../actions";
import type { Enums } from "@/lib/db/database.types";

/** The next step a statement can take, given where it is. */
const NEXT: Partial<
  Record<Enums<"statement_status">, { status: Enums<"statement_status">; label: string }>
> = {
  draft: { status: "issued", label: "Issue to owner" },
  issued: { status: "approved", label: "Approve for payment" },
  approved: { status: "paid", label: "Mark paid" },
};

export function StatementActions({
  statementId,
  status,
  canIssue,
  canDelete = false,
}: {
  statementId: string;
  status: Enums<"statement_status">;
  canIssue: boolean;
  /** dulshan@dubairapidproperties.com only (0054). */
  canDelete?: boolean;
}) {
  const [deleting, startDelete] = React.useTransition();
  const [state, action] = useActionState<ActionState, FormData>(
    updateStatementStatus,
    {}
  );

  React.useEffect(() => {
    if (state.success) toast.success(state.success);
    if (state.error) toast.error(state.error);
  }, [state]);

  const next = NEXT[status];

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => window.print()}>
        <Printer className="size-4" />
        Print / save PDF
      </Button>

      {canIssue && next && (
        <form action={action}>
          <input type="hidden" name="statementId" value={statementId} />
          <input type="hidden" name="status" value={next.status} />
          <Button type="submit">{next.label}</Button>
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
