"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
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
import { FormError, TextField } from "@/components/domain/form";
import { cancelKeepingPayout, type ActionState } from "../actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * The guest cancelled but the channel still pays: the stay is cancelled and
 * its payout still posts to the owner's income. On a cancelled stay, records
 * or changes the kept payout.
 */
export function KeptPayoutDialog({
  bookingId,
  cancelled,
  payout,
}: {
  bookingId: string;
  /** Already cancelled: only the payout is recorded. */
  cancelled: boolean;
  payout: number;
}) {
  const [open, setOpen] = React.useState(false);
  const submit = React.useMemo(() => cancelKeepingPayout.bind(null, bookingId), [bookingId]);
  const [state, action] = useActionState<ActionState, FormData>(submit, {});

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {cancelled ? (payout > 0 ? "Kept payout" : "Payout kept?") : "Cancel, payout kept"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{cancelled ? "Payout kept after cancelling" : "Cancel, payout kept"}</DialogTitle>
            <DialogDescription>
              The guest cancelled but the channel still pays (a strict cancellation policy).
              {!cancelled && " The booking is cancelled and its dates become free again."} The payout
              goes to the owner&apos;s income on the stay&apos;s check-out day.
              {cancelled && " Enter 0 if nothing is paid after all."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-4">
            <FormError message={state.error} />
            <TextField
              name="payout"
              label="Payout still paid (AED)"
              type="number"
              step="0.01"
              min={0}
              required
              defaultValue={payout > 0 ? payout : ""}
              hint='Airbnb: the "You earn" amount on the cancelled reservation.'
            />
            {!cancelled && <TextField name="reason" label="Reason" placeholder="Guest cancelled" />}
          </div>
          <DialogFooter>
            <Submit label={cancelled ? "Save payout" : "Cancel booking"} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
