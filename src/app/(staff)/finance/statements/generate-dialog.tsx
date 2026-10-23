"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { generateStatement, type ActionState } from "../actions";
import { monthBounds } from "@/lib/dates";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Generating…" : "Generate statement"}
    </Button>
  );
}

export function GenerateStatementDialog({
  owners,
  vatRate,
}: {
  owners: { id: string; full_name: string }[];
  /** company_settings.vat_rate, e.g. 0.05 */
  vatRate?: number | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState<ActionState, FormData>(generateStatement, {});

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  // Default to the month just ended, which is what finance runs each month.
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const { start, end } = monthBounds(lastMonth);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FilePlus2 className="size-4" />
          Generate statement
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Generate an owner statement</DialogTitle>
            <DialogDescription>
              Collected income and owner-borne expenses for the period are pulled from
              the ledger. The management fee is the % you set here, of that income;
              other fees are taken off as entered.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ownerId">Owner</Label>
              <Select id="ownerId" name="ownerId" required defaultValue="">
                <option value="" disabled>
                  Select an owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.full_name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">Period start</Label>
                <Input
                  id="periodStart"
                  name="periodStart"
                  type="date"
                  required
                  defaultValue={start}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">Period end</Label>
                <Input
                  id="periodEnd"
                  name="periodEnd"
                  type="date"
                  required
                  defaultValue={end}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="feePct">Management fee (%)</Label>
                <Input
                  id="feePct"
                  name="feePct"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  required
                  placeholder="e.g. 20"
                />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" name="feeVat" defaultChecked className="size-4" />
                Add VAT{vatRate ? ` (${Math.round(vatRate * 100)}%)` : ""} to the fee
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="otherFees">Other fees (AED)</Label>
                <Input
                  id="otherFees"
                  name="otherFees"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="otherFeesNote">Other fees are for</Label>
                <Input id="otherFeesNote" name="otherFeesNote" maxLength={200} placeholder="e.g. Key cutting, DEWA top-up" />
              </div>
            </div>

            <p className="text-xs text-[var(--muted-foreground)]">
              Net payout = income − expenses − management fee − VAT on the fee − other fees.
              Ledger lines already carried on another statement are skipped, so the same
              income can never be paid out twice.
            </p>
          </div>

          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
