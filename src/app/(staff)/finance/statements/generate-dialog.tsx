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
import { generateStatement, statementBookings, type ActionState, type StatementBooking } from "../actions";
import { formatDate, statementPeriod } from "@/lib/dates";
import { dubaiToday } from "@/lib/calendar";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Generating…" : "Generate statement"}
    </Button>
  );
}

const aed = (n: number) =>
  `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** AED or %, for a fee or a deduction that can be either (0061). */
function UnitSelect({ value, onChange, label }: { value: Unit; onChange: (u: Unit) => void; label: string }) {
  return (
    <Select aria-label={label} className="w-20 shrink-0" value={value} onChange={(e) => onChange(e.target.value as Unit)}>
      <option value="aed">AED</option>
      <option value="pct">%</option>
    </Select>
  );
}

type Unit = "aed" | "pct";

/**
 * A list of fees, item by item - what each is for and its amount - sent as
 * JSON in `name`. With `allowPct`, an item can be a % of the booking income
 * instead (0061); `income` shows what that comes to.
 */
function FeeItems({
  name,
  label,
  noun,
  placeholder,
  hint,
  allowPct = false,
  income,
}: {
  name: string;
  label: string;
  noun: string;
  placeholder: string;
  hint: string;
  allowPct?: boolean;
  /** The booking income after deductions, when known. */
  income?: number | null;
}) {
  const [items, setItems] = React.useState<{ key: number; description: string; amount: string; unit: Unit }[]>([]);
  const nextKey = React.useRef(0);
  const value = (i: { amount: string; unit: Unit }) =>
    i.unit === "pct" ? (income != null ? Math.round(income * (Number(i.amount) || 0)) / 100 : 0) : Number(i.amount) || 0;
  const total = items.reduce((sum, i) => sum + value(i), 0);
  const pctUnknown = income == null && items.some((i) => i.unit === "pct");
  const setItem = (key: number, patch: Partial<{ description: string; amount: string; unit: Unit }>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(
          items.map(({ description, amount, unit }) =>
            unit === "pct" ? { description, pct: Number(amount) } : { description, amount: Number(amount) }
          )
        )}
      />
      {items.map((item, n) => (
        <div key={item.key} className="flex gap-2">
          <Input
            aria-label={`${noun} ${n + 1}: what it is for`}
            placeholder={placeholder}
            required
            maxLength={200}
            value={item.description}
            onChange={(e) => setItem(item.key, { description: e.target.value })}
          />
          <Input
            aria-label={`${noun} ${n + 1}: ${item.unit === "pct" ? "% of booking income" : "amount (AED)"}`}
            placeholder={item.unit === "pct" ? "%" : "AED"}
            type="number"
            inputMode="decimal"
            min={0.01}
            max={item.unit === "pct" ? 100 : undefined}
            step="0.01"
            required
            className="w-28 shrink-0"
            value={item.amount}
            onChange={(e) => setItem(item.key, { amount: e.target.value })}
          />
          {allowPct && (
            <UnitSelect label={`${noun} ${n + 1}: AED or %`} value={item.unit} onChange={(unit) => setItem(item.key, { unit })} />
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label={`Remove ${noun.toLowerCase()} ${n + 1}`}
            onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setItems((list) => [...list, { key: nextKey.current++, description: "", amount: "", unit: "aed" }])}
        >
          <Plus className="size-4" />
          Add item
        </Button>
        {items.length > 0 && (
          <span className="text-sm text-[var(--muted-foreground)]">
            Total {aed(total)}
            {pctUnknown ? " + the % items" : ""}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>
    </div>
  );
}

/**
 * The bookings the statement will carry, each with a deduction - an amount or
 * a % of its rent (0061). The statement shows the rent after it. Sent as JSON
 * in bookingAdjustments; reports the income after deductions to `onIncome`.
 */
function BookingDeductions({
  ownerId,
  periodStart,
  periodEnd,
  onIncome,
}: {
  ownerId: string;
  periodStart: string;
  periodEnd: string;
  onIncome: (income: number | null) => void;
}) {
  const [bookings, setBookings] = React.useState<StatementBooking[] | null>(null);
  const [cuts, setCuts] = React.useState<Record<string, { value: string; unit: Unit }>>({});

  React.useEffect(() => {
    // Remounted (key) when the owner or period changes, so it starts empty.
    let live = true;
    if (!ownerId || !periodStart || !periodEnd || periodEnd < periodStart) return;
    statementBookings(ownerId, periodStart, periodEnd).then((rows) => {
      if (live) setBookings(rows);
    });
    return () => {
      live = false;
    };
  }, [ownerId, periodStart, periodEnd]);

  const cutOf = (b: StatementBooking) => {
    const c = cuts[b.ledgerEntryId];
    const v = Number(c?.value) || 0;
    return c?.unit === "pct" ? Math.round(b.amount * v) / 100 : v;
  };
  const income = bookings ? bookings.reduce((sum, b) => sum + b.amount - cutOf(b), 0) : null;
  React.useEffect(() => onIncome(income), [income, onIncome]);

  const payload = (bookings ?? [])
    .filter((b) => Number(cuts[b.ledgerEntryId]?.value) > 0)
    .map((b) =>
      cuts[b.ledgerEntryId].unit === "pct"
        ? { ledgerEntryId: b.ledgerEntryId, pct: Number(cuts[b.ledgerEntryId].value) }
        : { ledgerEntryId: b.ledgerEntryId, amount: Number(cuts[b.ledgerEntryId].value) }
    );

  return (
    <div className="space-y-2">
      <Label>Bookings</Label>
      <input type="hidden" name="bookingAdjustments" value={JSON.stringify(payload)} />
      {!ownerId ? (
        <p className="text-xs text-[var(--muted-foreground)]">Choose an owner to see the period&apos;s bookings.</p>
      ) : !periodStart || !periodEnd || periodEnd < periodStart ? (
        <p className="text-xs text-[var(--muted-foreground)]">Check the period dates.</p>
      ) : bookings === null ? (
        <p className="text-xs text-[var(--muted-foreground)]">Loading the bookings…</p>
      ) : bookings.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">No bookings in this period that are not on a statement already.</p>
      ) : (
        <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {bookings.map((b) => {
            const cut = cuts[b.ledgerEntryId] ?? { value: "", unit: "aed" as Unit };
            const over = cutOf(b) > b.amount;
            return (
              <div key={b.ledgerEntryId} className="space-y-2 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-medium">{b.guest}</span>
                  <span className="text-sm tabular-nums">{aed(b.amount)}</span>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {[b.unit, b.checkIn && b.checkOut ? `${formatDate(b.checkIn)} – ${formatDate(b.checkOut)}` : null, b.nights != null ? `${b.nights} nights` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted-foreground)]">Deduct</span>
                  <Input
                    aria-label={`Deduction from ${b.guest}`}
                    placeholder="0"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={cut.unit === "pct" ? 100 : b.amount}
                    step="0.01"
                    className="h-8 w-24"
                    value={cut.value}
                    onChange={(e) => setCuts((c) => ({ ...c, [b.ledgerEntryId]: { ...cut, value: e.target.value } }))}
                  />
                  <UnitSelect
                    label={`Deduction from ${b.guest}: AED or %`}
                    value={cut.unit}
                    onChange={(unit) => setCuts((c) => ({ ...c, [b.ledgerEntryId]: { ...cut, unit } }))}
                  />
                  <span className={`ml-auto text-xs tabular-nums ${over ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"}`}>
                    {over ? "More than the rent" : `Rent ${aed(b.amount - cutOf(b))}`}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex justify-between p-3 text-sm font-medium">
            <span>Rent on the statement</span>
            <span className="tabular-nums">{aed(income ?? 0)}</span>
          </div>
        </div>
      )}
      <p className="text-xs text-[var(--muted-foreground)]">
        What you deduct is taken off that booking&apos;s rent. The owner&apos;s statement shows only the rent after it,
        and the management fee is worked out on that.
      </p>
    </div>
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

  // Default to the period finance runs on the 15th: 16th to 15th.
  const { start, end } = statementPeriod(dubaiToday());
  const [ownerId, setOwnerId] = React.useState("");
  const [periodStart, setPeriodStart] = React.useState(start);
  const [periodEnd, setPeriodEnd] = React.useState(end);
  const [income, setIncome] = React.useState<number | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FilePlus2 className="size-4" />
          Generate statement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Generate an owner statement</DialogTitle>
            <DialogDescription>
              Collected income and owner-borne expenses for the period are pulled from
              the ledger. The management fee is the % you set here, worked out on each
              booking; utility fees are taken off item by item, each under its own name.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ownerId">Owner</Label>
              <Select id="ownerId" name="ownerId" required value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
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
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">Period end</Label>
                <Input
                  id="periodEnd"
                  name="periodEnd"
                  type="date"
                  required
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
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

            <FeeItems
              name="otherItems"
              label="Utility fees"
              noun="Utility fee"
              placeholder="e.g. DEWA, Etisalat, gas"
              hint="Each one is listed on the owner's statement under its own name, with the expenses."
            />
            <FeeItems
              name="otherCharges"
              label="Other fees"
              noun="Other fee"
              placeholder="What for (staff only)"
              hint="For our own figures only: never on the owner's statement and not taken off their payout. A % is of the booking income on the statement."
              allowPct
              income={income}
            />

            <BookingDeductions
              key={`${ownerId}|${periodStart}|${periodEnd}`}
              ownerId={ownerId} periodStart={periodStart} periodEnd={periodEnd} onIncome={setIncome} />

            <p className="text-xs text-[var(--muted-foreground)]">
              Net payout = rent after deductions − expenses − utility fees − management fee − VAT on the fee.
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
