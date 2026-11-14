"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FilePlus2, Pencil, Plus, X } from "lucide-react";
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
import { generateStatement, reviseStatement, statementBookings, type ActionState, type StatementBooking } from "../actions";
import { formatDate, statementPeriod } from "@/lib/dates";
import { dubaiToday } from "@/lib/calendar";

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {editing ? (pending ? "Saving…" : "Save changes") : pending ? "Generating…" : "Generate statement"}
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
export type FeeItem = { key: number; description: string; amount: string; unit: Unit };
/** A fee on one booking (0073), e.g. DTCM. */
export type BookingFee = { key: number; description: string; amount: string };
/**
 * Each booking's adjustment: taken off its rent, or with `add`, added to it
 * (0072); and its own fees - cleaning, guest fee, others - taken off with it (0073).
 */
export type Cut = {
  value: string;
  unit: Unit;
  add?: boolean;
  cleaning?: string;
  guest?: string;
  /** The booking's other fees, one amount (e.g. DTCM). */
  other?: string;
  fees?: BookingFee[];
  /** The rent and dates set by hand (0075), in place of the ledger's. */
  manual?: boolean;
  rent?: string;
  checkIn?: string;
  checkOut?: string;
};
export type Cuts = Record<string, Cut>;

/** yyyy-mm-dd plus some days. */
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** Nights between two yyyy-mm-dd dates. */
const nightsFrom = (checkIn: string, checkOut: string) =>
  Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);

/** The booking's own fees, named, as the statement keeps them. */
const feesOf = (c: Cut | undefined) =>
  c
    ? [
        { description: "Cleaning fee", amount: Number(c.cleaning) || 0 },
        { description: "Guest fee", amount: Number(c.guest) || 0 },
        { description: "Other fees", amount: Number(c.other) || 0 },
      ].filter((f) => f.amount > 0)
    : [];

/** Everything typed into the dialog, kept in this browser until the statement is made (a draft). */
export type Draft = {
  ownerId: string;
  /** One of the owner's units only (0075); empty for all of them. Missing in drafts saved before. */
  unitId?: string;
  periodStart: string;
  periodEnd: string;
  feePct: string;
  feeVat: boolean;
  utilities: FeeItem[];
  /** Maintenance fees (0072), on the statement's Maintenance row; missing in drafts saved before */
  maintenance?: FeeItem[];
  others: FeeItem[];
  cuts: Cuts;
};
const DRAFT_KEY = "drp:statement-draft";

function readDraft(): Draft | null {
  try {
    const d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null");
    return d && typeof d.ownerId === "string" && Array.isArray(d.utilities) && Array.isArray(d.others) ? d : null;
  } catch {
    return null;
  }
}

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
  items,
  onItems,
}: {
  name: string;
  label: string;
  noun: string;
  placeholder: string;
  hint: string;
  allowPct?: boolean;
  /** The booking income after deductions, when known. */
  income?: number | null;
  items: FeeItem[];
  onItems: (update: (list: FeeItem[]) => FeeItem[]) => void;
}) {
  const setItems = onItems;
  const nextKey = { current: items.reduce((max, i) => Math.max(max, i.key + 1), 0) };
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
 * in bookingAdjustments; reports the rent before the other fees to `onIncome`,
 * for the other fees given as a %.
 */
function BookingDeductions({
  ownerId,
  periodStart,
  periodEnd,
  statementId,
  unitId,
  onIncome,
  cuts,
  setCuts,
}: {
  ownerId: string;
  /** One of the owner's units only (0075). */
  unitId?: string;
  periodStart: string;
  periodEnd: string;
  /** The draft being edited: its own bookings are listed too. */
  statementId?: string;
  onIncome: (income: number | null) => void;
  cuts: Cuts;
  setCuts: (update: (cuts: Cuts) => Cuts) => void;
}) {
  const [bookings, setBookings] = React.useState<StatementBooking[] | null>(null);

  React.useEffect(() => {
    // Remounted (key) when the owner or period changes, so it starts empty.
    let live = true;
    if (!ownerId || !periodStart || !periodEnd || periodEnd < periodStart) return;
    statementBookings(ownerId, periodStart, periodEnd, statementId, unitId || undefined).then((rows) => {
      if (live) setBookings(rows);
    });
    return () => {
      live = false;
    };
  }, [ownerId, periodStart, periodEnd, statementId, unitId]);

  /** The rent before the adjustment: set by hand (0075), else the ledger's. */
  const rentOf = (b: StatementBooking) => {
    const c = cuts[b.ledgerEntryId];
    return c?.manual && c.rent !== undefined && c.rent !== "" && Number(c.rent) >= 0 ? Number(c.rent) : b.amount;
  };
  /** Taken off the ledger's amount by the booking itself: the rent set by hand, the adjustment, its cleaning and guest fees. */
  const ownCutOf = (b: StatementBooking) => {
    const c = cuts[b.ledgerEntryId];
    const rent = rentOf(b);
    const v = (Number(c?.value) || 0) * (c?.add ? -1 : 1);
    const adjust = c?.unit === "pct" ? Math.round(rent * v) / 100 : v;
    return b.amount - rent + adjust + feesOf(c).reduce((sum, f) => sum + f.amount, 0);
  };
  const cutOf = ownCutOf;
  const income = bookings ? bookings.reduce((sum, b) => sum + b.amount - cutOf(b), 0) : null;
  React.useEffect(() => onIncome(income), [income, onIncome]);

  const payload = (bookings ?? [])
    .filter(
      (b) =>
        Number(cuts[b.ledgerEntryId]?.value) > 0 ||
        feesOf(cuts[b.ledgerEntryId]).length > 0 ||
        cuts[b.ledgerEntryId]?.manual
    )
    .map((b) => {
      const c: Cut = cuts[b.ledgerEntryId] ?? { value: "", unit: "aed" };
      const v = (Number(c.value) || 0) * (c.add ? -1 : 1);
      const items = feesOf(c);
      const byHand = c.manual
        ? {
            ...(c.rent !== undefined && c.rent !== "" ? { rent: Number(c.rent) } : {}),
            ...(c.checkIn && c.checkOut ? { checkIn: c.checkIn, checkOut: c.checkOut } : {}),
          }
        : {};
      return v === 0
        ? { ledgerEntryId: b.ledgerEntryId, items, ...byHand }
        : c.unit === "pct"
          ? { ledgerEntryId: b.ledgerEntryId, pct: v, items, ...byHand }
          : { ledgerEntryId: b.ledgerEntryId, amount: v, items, ...byHand };
    });

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
            const cut: Cut = cuts[b.ledgerEntryId] ?? { value: "", unit: "aed" };
            const over = cutOf(b) > b.amount;
            const badDates = !!(cut.manual && cut.checkIn && cut.checkOut && cut.checkOut <= cut.checkIn);
            // The dates the statement would show on its own: the stay's part in the period.
            const autoOut = b.checkIn && b.nights != null ? addDays(b.checkIn, b.nights) : b.checkOut;
            const setCut = (patch: Partial<Cut>) => setCuts((c) => ({ ...c, [b.ledgerEntryId]: { ...cut, ...c[b.ledgerEntryId], ...patch } }));
            const money = (label: string, value: string | undefined, onChange: (v: string) => void) => (
              <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span className="w-20 shrink-0">{label}</span>
                <Input
                  aria-label={`${label} for ${b.guest} (AED)`}
                  placeholder="AED"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="h-8 w-28"
                  value={value ?? ""}
                  onChange={(e) => onChange(e.target.value)}
                />
              </label>
            );
            return (
              <div key={b.ledgerEntryId} className="space-y-2 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-medium">{b.guest}</span>
                  <span className="text-sm tabular-nums">
                    {cut.manual && rentOf(b) !== b.amount && (
                      <span className="mr-2 text-xs text-[var(--muted-foreground)] line-through">{aed(b.amount)}</span>
                    )}
                    {aed(rentOf(b))}
                  </span>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {[b.unit, b.checkIn && b.checkOut ? `${formatDate(b.checkIn)} – ${formatDate(b.checkOut)}` : null, b.nights != null ? `${b.nights} nights` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={!!cut.manual}
                    onChange={(e) =>
                      setCut(
                        e.target.checked
                          ? {
                              manual: true,
                              rent: cut.rent || String(b.amount),
                              checkIn: cut.checkIn || b.checkIn || "",
                              checkOut: cut.checkOut || autoOut || "",
                            }
                          : { manual: false }
                      )
                    }
                  />
                  Set the dates and rent by hand
                </label>
                {cut.manual && (
                  <div className="space-y-2 rounded-md bg-[var(--muted)] p-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="space-y-1 text-xs text-[var(--muted-foreground)]">
                        <span>Check-in</span>
                        <Input
                          type="date"
                          required
                          className="h-8"
                          aria-label={`${b.guest}: check-in on the statement`}
                          value={cut.checkIn ?? ""}
                          onChange={(e) => setCut({ checkIn: e.target.value })}
                        />
                      </label>
                      <label className="space-y-1 text-xs text-[var(--muted-foreground)]">
                        <span>Check-out</span>
                        <Input
                          type="date"
                          required
                          className="h-8"
                          aria-label={`${b.guest}: check-out on the statement`}
                          value={cut.checkOut ?? ""}
                          onChange={(e) => setCut({ checkOut: e.target.value })}
                        />
                      </label>
                      <label className="space-y-1 text-xs text-[var(--muted-foreground)]">
                        <span>Rent (AED)</span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          required
                          className="h-8"
                          aria-label={`${b.guest}: rent on the statement (AED)`}
                          value={cut.rent ?? ""}
                          onChange={(e) => setCut({ rent: e.target.value })}
                        />
                      </label>
                    </div>
                    <p className={`text-xs ${badDates ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"}`}>
                      {badDates
                        ? "The check-out must come after the check-in."
                        : `${cut.checkIn && cut.checkOut ? `${nightsFrom(cut.checkIn, cut.checkOut)} nights · ` : ""}Worked out on its own: ${aed(b.amount)}${b.nights != null ? `, ${b.nights} nights` : ""}. Untick to use it.`}
                    </p>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {money("Cleaning fee", cut.cleaning, (cleaning) => setCut({ cleaning }))}
                  {money("Guest fee", cut.guest, (guest) => setCut({ guest }))}
                  {money("Other fees", cut.other, (other) => setCut({ other }))}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    aria-label={`${b.guest}: deduct from or add to the rent`}
                    className="h-8 w-24 shrink-0"
                    value={cut.add ? "add" : "deduct"}
                    onChange={(e) => setCuts((c) => ({ ...c, [b.ledgerEntryId]: { ...cut, add: e.target.value === "add" } }))}
                  >
                    <option value="deduct">Deduct</option>
                    <option value="add">Add</option>
                  </Select>
                  <Input
                    aria-label={cut.add ? `Added to ${b.guest}'s rent` : `Deduction from ${b.guest}`}
                    placeholder="0"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={cut.add ? undefined : cut.unit === "pct" ? 100 : b.amount}
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
        Each booking&apos;s cleaning fee, guest fee and other fees are taken off its rent at once, with
        what you deduct; what you add goes on it (e.g. an Airbnb stay whose price came in for one night only). The
        owner&apos;s statement shows only the rent after them, and the management fee is worked out on that.
      </p>
    </div>
  );
}

export function GenerateStatementDialog({
  owners,
  vatRate,
  edit,
}: {
  /** With their units, for a statement per unit (0075). */
  owners: { id: string; full_name: string; units?: { id: string; label: string }[] }[];
  /** company_settings.vat_rate, e.g. 0.05 */
  vatRate?: number | null;
  /** A draft statement to change (0071): opened with its figures, for its owner only. */
  edit?: { statementId: string; draft: Draft };
}) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState<ActionState, FormData>(edit ? reviseStatement : generateStatement, {});
  const editing = !!edit;

  // Default to the period finance runs on the 15th: 16th to 15th.
  const { start, end } = statementPeriod(dubaiToday());
  const blank: Draft = edit?.draft ?? { ownerId: "", periodStart: start, periodEnd: end, feePct: "", feeVat: true, utilities: [], maintenance: [], others: [], cuts: {} };
  const [draft, setDraft] = React.useState<Draft>(blank);
  const [restored, setRestored] = React.useState(false);
  const [, setIncome] = React.useState<number | null>(null);
  const loaded = React.useRef(false);
  const saving = React.useRef(true);

  // The draft left from before (the dialog closed, the page reloaded), the first time the dialog opens.
  const onOpenChange = (next: boolean) => {
    // An edit always opens on the statement as it is.
    if (next && editing) setDraft(blank);
    if (next && !editing && !loaded.current) {
      loaded.current = true;
      const saved = readDraft();
      if (saved) {
        setDraft({ ...blank, ...saved });
        setRestored(true);
      }
    }
    setOpen(next);
  };
  React.useEffect(() => {
    if (editing || !loaded.current || !saving.current) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* Storage blocked: the dialog still keeps it while the page is open */
    }
  }, [draft, editing]);
  React.useEffect(() => {
    if (!state.error) return;
    toast.error(state.error);
    // Not made: keep the draft for the next try.
    saving.current = true;
    if (editing) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  /* A different owner or period has other bookings: their deductions start again */
  const setScope = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch, cuts: {} }));
  const startOver = () => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {}
    setDraft(blank);
    setRestored(false);
  };
  const { ownerId, periodStart, periodEnd } = draft;
  const ownerUnits = owners.find((o) => o.id === ownerId)?.units ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="outline">
            <Pencil className="size-4" />
            Edit
          </Button>
        ) : (
          <Button>
            <FilePlus2 className="size-4" />
            Generate statement
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        // A click outside (or Esc) used to close it and lose what was typed: only the close button does now.
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <form
          action={action}
          onSubmit={() => {
            if (editing) return;
            // Made (the page moves to the statement): the draft is done. An error saves it again.
            saving.current = false;
            try {
              window.localStorage.removeItem(DRAFT_KEY);
            } catch {}
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "Edit the statement" : "Generate an owner statement"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "The statement is built again from the ledger with what you set here, so bookings or expenses corrected since are picked up too. It keeps its number and stays a draft."
                : "Collected income and owner-borne expenses for the period are pulled from the ledger. The management fee is the % you set here, worked out on each booking; utility fees are taken off item by item, each under its own name."}
            </DialogDescription>
          </DialogHeader>
          {edit && <input type="hidden" name="statementId" value={edit.statementId} />}

          <div className="my-4 space-y-4">
            {restored && (
              <div className="flex items-center justify-between gap-3 rounded-md bg-[var(--muted)] px-3 py-2 text-sm">
                <span>Your draft is back where you left it.</span>
                <Button type="button" size="sm" variant="ghost" onClick={startOver}>
                  Start over
                </Button>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ownerId">Owner</Label>
              <Select
                id="ownerId"
                name="ownerId"
                required
                disabled={editing}
                value={ownerId}
                onChange={(e) => setScope({ ownerId: e.target.value, unitId: "" })}
              >
                <option value="" disabled>
                  Select an owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.full_name}
                  </option>
                ))}
              </Select>
              {/* A disabled field is not sent */}
              {editing && <input type="hidden" name="ownerId" value={ownerId} />}
            </div>

            {(ownerUnits.length > 1 || draft.unitId) && (
              <div className="space-y-1.5">
                <Label htmlFor="unitId">Unit</Label>
                <Select
                  id="unitId"
                  name="unitId"
                  disabled={editing}
                  value={draft.unitId ?? ""}
                  onChange={(e) => setScope({ unitId: e.target.value })}
                >
                  <option value="">All {ownerUnits.length || ""} units on one statement</option>
                  {ownerUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Choose a unit to make its own statement: only its bookings and the fees you enter here go on it.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">Period start</Label>
                <Input
                  id="periodStart"
                  name="periodStart"
                  type="date"
                  required
                  value={periodStart}
                  onChange={(e) => setScope({ periodStart: e.target.value })}
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
                  onChange={(e) => setScope({ periodEnd: e.target.value })}
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
                  value={draft.feePct}
                  onChange={(e) => set({ feePct: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  name="feeVat"
                  checked={draft.feeVat}
                  onChange={(e) => set({ feeVat: e.target.checked })}
                  className="size-4"
                />
                Add VAT{vatRate ? ` (${Math.round(vatRate * 100)}%)` : ""} to the fee
              </label>
            </div>

            <FeeItems
              name="otherItems"
              label="Utility fees"
              noun="Utility fee"
              placeholder="e.g. DEWA, Etisalat, gas"
              hint="Each one is listed on the owner's statement under its own name, with the expenses."
              items={draft.utilities}
              onItems={(update) => setDraft((d) => ({ ...d, utilities: update(d.utilities) }))}
            />
            <FeeItems
              name="maintenanceItems"
              label="Maintenance fees"
              noun="Maintenance fee"
              placeholder="e.g. AC service, plumbing"
              hint="Each one is listed on the owner's statement under its own name, on the Maintenance row after Utilities."
              items={draft.maintenance ?? []}
              onItems={(update) => setDraft((d) => ({ ...d, maintenance: update(d.maintenance ?? []) }))}
            />
            {/* Other fees are entered on each booking now, and taken off its rent (0073) */}
            <input type="hidden" name="otherCharges" value="[]" />

            <BookingDeductions
              key={`${ownerId}|${draft.unitId ?? ""}|${periodStart}|${periodEnd}`}
              ownerId={ownerId}
              periodStart={periodStart}
              periodEnd={periodEnd}
              statementId={edit?.statementId}
              unitId={draft.unitId}
              onIncome={setIncome}
              cuts={draft.cuts}
              setCuts={(update) => setDraft((d) => ({ ...d, cuts: update(d.cuts) }))}
            />

            <p className="text-xs text-[var(--muted-foreground)]">
              Net payout = rent after adjustments − expenses − utility fees − maintenance fees − management fee − VAT on the fee.
              Ledger lines already carried on another statement are skipped, so the same
              income can never be paid out twice.
            </p>
          </div>

          <DialogFooter>
            <Submit editing={editing} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
