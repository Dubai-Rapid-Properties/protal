"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FilePlus2, Plus, X } from "lucide-react";
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
  // Utility fees, item by item: what each is for and its amount.
  const [items, setItems] = React.useState<{ key: number; description: string; amount: string }[]>([]);
  const nextKey = React.useRef(0);
  const otherTotal = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const addItem = () => setItems((list) => [...list, { key: nextKey.current++, description: "", amount: "" }]);
  const setItem = (key: number, field: "description" | "amount", value: string) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, [field]: value } : i)));

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
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Generate an owner statement</DialogTitle>
            <DialogDescription>
              Collected income and owner-borne expenses for the period are pulled from
              the ledger. The management fee is the % you set here, of that income;
              utility fees are taken off item by item, each under its own name.
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

            <div className="space-y-2">
              <Label>Utility fees</Label>
              <input
                type="hidden"
                name="otherItems"
                value={JSON.stringify(items.map(({ description, amount }) => ({ description, amount })))}
              />
              {items.map((item, n) => (
                <div key={item.key} className="flex gap-2">
                  <Input
                    aria-label={`Utility fee ${n + 1}: what it is for`}
                    placeholder="e.g. DEWA, Etisalat, gas"
                    required
                    maxLength={200}
                    value={item.description}
                    onChange={(e) => setItem(item.key, "description", e.target.value)}
                  />
                  <Input
                    aria-label={`Utility fee ${n + 1}: amount (AED)`}
                    placeholder="AED"
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    step="0.01"
                    required
                    className="w-32 shrink-0"
                    value={item.amount}
                    onChange={(e) => setItem(item.key, "amount", e.target.value)}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0"
                    aria-label={`Remove utility fee ${n + 1}`}
                    onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <Button type="button" size="sm" variant="outline" onClick={addItem}>
                  <Plus className="size-4" />
                  Add item
                </Button>
                {items.length > 0 && (
                  <span className="text-sm text-[var(--muted-foreground)]">
                    Total AED {otherTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-[var(--muted-foreground)]">
              Net payout = income − expenses − management fee − VAT on the fee − utility fees.
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
