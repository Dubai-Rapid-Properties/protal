"use client";

import * as React from "react";
import { Check, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteRefund, settleRefund } from "./actions";

/** Super admins: refunded / declined, back to waiting, or delete a mistake. */
export function SettleButtons({ refundId, status }: { refundId: string; status: string }) {
  const [pending, start] = React.useTransition();

  const settle = (next: "refunded" | "rejected" | "pending", note?: string) =>
    start(async () => {
      const data = new FormData();
      data.set("status", next);
      if (note) data.set("note", note);
      const result = await settleRefund(refundId, data);
      if (result.error) toast.error(result.error);
      else toast.success(result.success);
    });

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {status === "pending" ? (
        <>
          <Button type="button" size="sm" disabled={pending} onClick={() => settle("refunded")}>
            <Check className="size-4" />
            Refunded
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              const note = prompt("Decline this claim?\n\nReason (optional):");
              if (note !== null) settle("rejected", note);
            }}
          >
            <X className="size-4" />
            Decline
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => settle("pending")}>
          <RotateCcw className="size-4" />
          Undo
        </Button>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Delete claim"
        disabled={pending}
        onClick={() => {
          if (!confirm("Delete this claim and its receipt? Only for a claim entered by mistake.")) return;
          start(async () => {
            const result = await deleteRefund(refundId);
            if (result.error) toast.error(result.error);
            else toast.success(result.success);
          });
        }}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
