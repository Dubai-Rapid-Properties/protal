"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SelectField, TextAreaField, TextField } from "@/components/domain/form";
import { Label } from "@/components/ui/label";
import {
  MAINTENANCE_CATEGORY,
  MAINTENANCE_PRIORITY,
  TICKET_CATEGORIES,
  TICKET_KIND,
  optionsFrom,
  type TicketKind,
} from "@/lib/labels";

/**
 * What the issue is: repair or complaint, its category (the list follows the
 * kind), priority, title and details. Shared by the staff and owner forms so
 * both describe a ticket the same way.
 */
export function TicketFields({
  defaultKind = "repair",
  defaults,
  showPriority = true,
}: {
  defaultKind?: TicketKind;
  /** An existing ticket's values, when editing it */
  defaults?: { category?: string; title?: string; description?: string | null; accessNotes?: string | null };
  /** Off where priority is set elsewhere (the ticket page's Handling card) */
  showPriority?: boolean;
}) {
  const [kind, setKind] = React.useState<TicketKind>(defaultKind);
  const categories = TICKET_CATEGORIES[kind] as string[];

  return (
    <>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>
          Type<span className="ml-0.5 text-[var(--destructive)]">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TICKET_KIND) as TicketKind[]).map((k) => (
            <label
              key={k}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm",
                kind === k
                  ? "border-[var(--primary)] bg-[var(--muted)]"
                  : "border-[var(--border)] hover:bg-[var(--muted)]/60"
              )}
            >
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{TICKET_KIND[k]}</span>
                <span className="block text-xs text-[var(--muted-foreground)]">
                  {k === "repair"
                    ? "Something broken or not working"
                    : "Noise, cleaning, neighbours, service"}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <SelectField
        key={kind}
        name="category"
        label="Category"
        required
        defaultValue={defaults?.category && categories.includes(defaults.category) ? defaults.category : TICKET_CATEGORIES[kind][0]}
        options={TICKET_CATEGORIES[kind].map((c) => ({ value: c, label: MAINTENANCE_CATEGORY[c] }))}
      />
      {showPriority && (
        <SelectField
          name="priority"
          label="Priority"
          required
          defaultValue="medium"
          options={optionsFrom(MAINTENANCE_PRIORITY)}
          hint="Emergency: water leak, no power, security risk."
        />
      )}
      <TextField
        name="title"
        label="Short title"
        required
        maxLength={150}
        wide
        defaultValue={defaults?.title}
        placeholder={kind === "repair" ? "AC not cooling in the bedroom" : "Loud music from the next unit at night"}
      />
      <TextAreaField
        name="description"
        label="Details"
        rows={4}
        maxLength={4000}
        defaultValue={defaults?.description ?? undefined}
        placeholder="What happened, since when, anything already tried."
      />
      <TextAreaField
        name="accessNotes"
        label="Access notes"
        rows={2}
        maxLength={1000}
        defaultValue={defaults?.accessNotes ?? undefined}
        placeholder="Keys, best time to visit, guest or tenant in the unit, pets."
      />
    </>
  );
}
