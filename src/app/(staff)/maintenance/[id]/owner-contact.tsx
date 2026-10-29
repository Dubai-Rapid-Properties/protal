"use client";

import * as React from "react";
import { BellRing, CheckCircle2, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setOwnerContact } from "../actions";

export type OwnerToCall = { name: string; phone: string | null; email: string | null };

/**
 * Has someone spoken to the owner about this ticket? Until they have,
 * operations is emailed every two hours (0065); "Contacted" stops it.
 */
export function OwnerContactCard({
  ticketId,
  contacted,
  contactedLine,
  reminders,
  owners,
  canMark,
  everyHours,
  inbox,
}: {
  ticketId: string;
  contacted: boolean;
  /** "By Sara on 29 Oct, 14:05" */
  contactedLine: string | null;
  reminders: number;
  owners: OwnerToCall[];
  canMark: boolean;
  everyHours: number;
  inbox: string;
}) {
  const [pending, start] = React.useTransition();
  const mark = (value: boolean) =>
    start(async () => {
      const result = await setOwnerContact(ticketId, value);
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
    });

  return (
    <Card className={contacted ? undefined : "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20"}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {contacted ? (
            <CheckCircle2 className="size-4 text-emerald-600" />
          ) : (
            <BellRing className="size-4 animate-pulse text-amber-600" />
          )}
          Owner contact
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {contacted ? (
          <p>
            <span className="font-medium">Owner contacted.</span> {contactedLine}
          </p>
        ) : (
          <p>
            <span className="font-medium">Not contacted yet.</span> {inbox} is reminded every {everyHours} hours
            until this is marked contacted
            {reminders ? ` (${reminders} reminder${reminders === 1 ? "" : "s"} sent so far)` : ""}.
          </p>
        )}

        {owners.length ? (
          <ul className="grid gap-1.5">
            {owners.map((o) => (
              <li key={`${o.name}-${o.phone}-${o.email}`} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <p className="font-medium">{o.name}</p>
                {o.phone ? (
                  <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1.5 text-[var(--muted-foreground)] hover:underline">
                    <Phone className="size-3.5" />
                    {o.phone}
                  </a>
                ) : null}
                {o.email ? <p className="break-all text-[var(--muted-foreground)]">{o.email}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[var(--muted-foreground)]">No owner is recorded for this unit.</p>
        )}

        {canMark ? (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Owner contacted?">
            <Button
              type="button"
              size="sm"
              variant={contacted ? "default" : "outline"}
              aria-pressed={contacted}
              disabled={pending || contacted}
              onClick={() => mark(true)}
            >
              Contacted
            </Button>
            <Button
              type="button"
              size="sm"
              variant={contacted ? "outline" : "secondary"}
              aria-pressed={!contacted}
              disabled={pending || !contacted}
              onClick={() => mark(false)}
            >
              Not yet
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
