"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormError, SelectField, TextAreaField, TextField } from "@/components/domain/form";
import { addManagementAgreement, endManagementAgreement, type ActionState } from "../actions";

type UnitOption = { id: string; label: string; mode: "long_term" | "short_term" | "both" };

const MODES = [
  { value: "long_term", label: "Long-term lettings" },
  { value: "short_term", label: "Holiday homes (short stays)" },
  { value: "both", label: "Both" },
];

/** Records a management agreement for one of the owner's units: the fee owner statements charge. */
export function AgreementDialog({ ownerId, units }: { ownerId: string; units: UnitOption[] }) {
  const [open, setOpen] = React.useState(false);
  const [unitId, setUnitId] = React.useState(units[0]?.id ?? "");
  const [mode, setMode] = React.useState<UnitOption["mode"]>(units[0]?.mode ?? "long_term");
  const [feeType, setFeeType] = React.useState<"commission" | "fixed">("commission");
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await addManagementAgreement(ownerId, prev, formData);
    if (result.success) {
      toast.success(result.success);
      setOpen(false);
    }
    return result;
  }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={units.length === 0} title={units.length === 0 ? "Link the owner to a unit first" : undefined}>
          <Plus className="size-4" />
          Add agreement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Record a management agreement</DialogTitle>
            <DialogDescription>
              Owner statements charge the management fee from this. Keep the signed copy under Documents.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            <SelectField
              name="unitId"
              label="Unit"
              required
              wide
              value={unitId}
              onChange={(e) => {
                setUnitId(e.target.value);
                const unit = units.find((u) => u.id === e.target.value);
                if (unit) setMode(unit.mode);
              }}
              options={units.map((u) => ({ value: u.id, label: u.label }))}
            />
            <SelectField
              name="serviceMode"
              label="Service"
              required
              wide
              value={mode}
              onChange={(e) => setMode(e.target.value as UnitOption["mode"])}
              options={MODES}
            />
            <TextField name="startDate" label="Start date" type="date" required />
            <TextField
              name="endDate"
              label="End date"
              type="date"
              required
              hint="If the agreement has no fixed end, enter its first renewal date and keep “Renews automatically” ticked."
            />

            <SelectField
              name="feeType"
              label="Fee"
              required
              value={feeType}
              onChange={(e) => setFeeType(e.target.value as "commission" | "fixed")}
              options={[
                { value: "commission", label: "A percentage of the unit's income" },
                { value: "fixed", label: "A fixed amount" },
              ]}
            />
            {feeType === "commission" ? (
              <TextField
                key="commission"
                name="commissionPct"
                label="Commission (%)"
                type="number"
                min={0}
                max={100}
                step="0.01"
                required
              />
            ) : (
              <TextField
                key="fixed"
                name="fixedFeeAed"
                label="Fixed fee (AED)"
                type="number"
                min={0}
                step="0.01"
                required
                hint="Charged on each owner statement."
              />
            )}
            <TextField name="noticeDays" label="Notice period (days)" type="number" min={0} max={365} defaultValue={60} required />

            <div className="space-y-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="feeVat" defaultChecked className="size-4" />
                VAT applies to the management fee
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="autoRenew" defaultChecked className="size-4" />
                Renews automatically
              </label>
            </div>
            <TextAreaField name="notes" label="Notes" rows={2} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save agreement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EndAgreementButton({ agreementId, ownerId }: { agreementId: string; ownerId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("End this agreement? Owner statements stop charging its fee from now on.")) return;
        start(async () => {
          const result = await endManagementAgreement(agreementId, ownerId);
          if (result.error) toast.error(result.error);
          else toast.success(result.success ?? "Agreement ended.");
        });
      }}
    >
      {pending ? "Ending…" : "End"}
    </Button>
  );
}
