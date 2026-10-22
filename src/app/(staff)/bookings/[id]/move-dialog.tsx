"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRightLeft } from "lucide-react";
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
import { FormError, SelectField } from "@/components/domain/form";
import { moveBooking, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Moving…" : "Move stay"}
    </Button>
  );
}

/** Moves the stay to the unit the guest really stays in. */
export function MoveDialog({
  bookingId,
  synced,
  units,
}: {
  bookingId: string;
  /** From the unit's Airbnb calendar: the reservation stays on that listing. */
  synced: boolean;
  units: { id: string; label: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const submit = React.useMemo(() => moveBooking.bind(null, bookingId), [bookingId]);
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
          <ArrowRightLeft className="size-4" />
          Move
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Move to another unit</DialogTitle>
            <DialogDescription>
              For a guest who booked one unit and stays in another. The calendar hold, the
              turnover clean and the stay&apos;s income go to the new unit and its owner.
              {synced &&
                " The Airbnb reservation stays on this unit's listing: its calendar sync skips it from now on, so a date change on Airbnb is entered here by hand."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-4">
            <FormError message={state.error} />
            <SelectField
              name="unitId"
              label="Unit the guest stays in"
              required
              defaultValue=""
              placeholder="Select a unit"
              options={units.map((u) => ({ value: u.id, label: u.label }))}
            />
          </div>
          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
