"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Callout } from "@/components/domain/shared";
import { FormError, FormSection, SubmitBar, TextAreaField, TextField } from "@/components/domain/form";
import { seasonsFromNights } from "@/lib/airbnb/listing-prices";
import { seasonsToText } from "@/lib/website-options";
import { loadUnitPrices, saveAirbnbPrices, type ListingCapture, type PricesState, type UnitPrices } from "./actions";

type Unit = { id: string; label: string };
type Found = Extract<ListingCapture, { listing: unknown }>;

const FIELDS = [
  { key: "nightly", label: "Nightly rate (AED)", unit: "AED" },
  { key: "weekend", label: "Weekend rate, Fri & Sat (AED)", unit: "AED" },
  { key: "cleaning", label: "Cleaning fee (AED)", unit: "AED" },
  { key: "weeklyDiscount", label: "Weekly discount (%)", unit: "%" },
  { key: "monthlyDiscount", label: "Monthly discount (%)", unit: "%" },
] as const;

/** Airbnb's prices onto the unit's own rates, each shown old → new. */
export function PricesReview({
  found,
  units,
  initialUnit,
  onReset,
}: {
  found: Found;
  units: Unit[];
  initialUnit: string;
  onReset: () => void;
}) {
  const { prices } = found;
  const [unitId, setUnitId] = React.useState(units.some((u) => u.id === initialUnit) ? initialUnit : "");
  const [loaded, setLoaded] = React.useState<{ error: string } | { unit: UnitPrices } | null>(null);
  const [loading, startLoading] = React.useTransition();

  React.useEffect(() => {
    setLoaded(null);
    if (unitId) startLoading(async () => setLoaded(await loadUnitPrices(unitId)));
  }, [unitId]);

  const foreign = prices.currency && prices.currency !== "AED";

  return (
    <div className="space-y-5">
      <Callout tone="info" title="The prices on the Airbnb page right now">
        With the D|R|P extension (version 1.1 or later) these are saved on their own whenever the listing&apos;s
        Pricing or Calendar page is open on Airbnb. Smart Pricing changes Airbnb makes by itself only arrive when
        that page is opened.
      </Callout>
      {foreign ? (
        <Callout tone="danger" title={`The page shows prices in ${prices.currency === "mixed" ? "several currencies" : prices.currency}`}>
          The portal keeps AED, so nothing can be saved from this page. Switch the listing&apos;s currency to AED on
          Airbnb (or enter the rates in the unit&apos;s details yourself).
        </Callout>
      ) : (
        !prices.currency && (
          <Callout tone="warning" title="No currency on the page">
            Check these are AED before saving.
          </Callout>
        )
      )}

      <FormSection title="Unit">
        <div className="space-y-1.5 sm:col-span-2">
          <Select aria-label="Unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Select the unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </Select>
          {found.unitId && unitId === found.unitId && (
            <p className="text-xs text-[var(--muted-foreground)]">Found from the unit&apos;s Airbnb calendar.</p>
          )}
        </div>
      </FormSection>

      {loading && <p className="text-sm text-[var(--muted-foreground)]">Opening the unit…</p>}
      {loaded && "error" in loaded && <FormError message={loaded.error} />}
      {loaded && "unit" in loaded && !foreign && <PricesForm key={loaded.unit.id} found={found} unit={loaded.unit} />}

      <Button type="button" variant="ghost" onClick={onReset}>
        <RotateCcw className="size-4" />
        Start over
      </Button>
    </div>
  );
}

function PricesForm({ found, unit }: { found: Found; unit: UnitPrices }) {
  const { prices, today } = found;
  const [state, action] = useActionState<PricesState, FormData>(saveAirbnbPrices.bind(null, unit.id), {});
  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);

  const rows = seasonsFromNights(prices.nights, prices.nightly ?? unit.nightly, today);
  const show = (n: number | null, u: string) => (n == null ? "none" : u === "%" ? `${n}%` : `AED ${n}`);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      {state.success && (
        <Callout tone="info" title="Saved">
          {state.success}{" "}
          <Link className="underline" href={`/units/${unit.id}`}>
            Open the unit
          </Link>
        </Callout>
      )}
      <FormSection title={`Rates for ${unit.label}`} description="Filled in from Airbnb; change anything before saving." columns={1}>
        {FIELDS.map((f) => {
          const now = unit[f.key];
          const airbnb = prices[f.key];
          const hint =
            airbnb == null
              ? `Not on the Airbnb page: stays ${show(now, f.unit)}.`
              : airbnb === now
                ? `Unchanged: ${show(now, f.unit)}.`
                : `Changes: ${show(now, f.unit)} → ${show(airbnb, f.unit)}.`;
          return (
            <TextField
              key={f.key}
              name={f.key}
              label={f.label}
              type="number"
              step="0.01"
              min="0"
              defaultValue={String(airbnb ?? now ?? "")}
              hint={<span className={airbnb != null && airbnb !== now ? "font-medium text-[var(--foreground)]" : undefined}>{hint}</span>}
            />
          );
        })}
      </FormSection>

      {rows.length > 0 && (
        <FormSection
          title="Seasonal rates on the website"
          description={`From ${prices.nights.length} nights on the Airbnb calendar: nights at a different price than the nightly rate, consecutive nights at one price merged.`}
          columns={1}
        >
          {rows.length > 100 && (
            <Callout tone="warning" title={`${rows.length} price changes`}>
              The calendar changes price almost every night (Smart Pricing?). Only the first 100 fit; consider leaving
              seasons out.
            </Callout>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="replaceSeasons" defaultChecked className="size-4" />
            Replace the website&apos;s seasonal rates with these
          </label>
          <TextAreaField
            name="seasons"
            label="Seasons"
            rows={8}
            defaultValue={seasonsToText(rows.slice(0, 100))}
            hint={`One per line: Name | first night | last night | nightly rate (AED). Now: ${
              unit.seasons ? `${unit.seasons.split("\n").length} rows` : "none"
            }.`}
          />
        </FormSection>
      )}

      <div className="flex justify-end">
        <SubmitBar label="Save prices to the unit" />
      </div>
    </form>
  );
}
