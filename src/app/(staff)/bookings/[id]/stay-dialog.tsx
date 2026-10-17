"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
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
import { updateBookingStay, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save stay"}
    </Button>
  );
}

/** Corrects a stay's dates and guest count. Not offered for stays synced from the Airbnb calendar. */
export function StayDialog({
  bookingId,
  stay,
}: {
  bookingId: string;
  stay: { checkIn: string; checkOut: string; adults: number; children: number; infants: number };
}) {
  const [open, setOpen] = React.useState(false);
  const [checkIn, setCheckIn] = React.useState(stay.checkIn);
  const submit = React.useMemo(() => updateBookingStay.bind(null, bookingId), [bookingId]);
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
          <Pencil className="size-4" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Edit stay</DialogTitle>
            <DialogDescription>
              The guest&apos;s real dates and party. The calendar and the owner&apos;s portal follow;
              the price stays as it is.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            <TextField
              name="checkIn"
              label="Check-in"
              type="date"
              required
              defaultValue={stay.checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
            />
            <TextField
              name="checkOut"
              label="Check-out"
              type="date"
              required
              min={checkIn || undefined}
              defaultValue={stay.checkOut}
            />
            <TextField name="adults" label="Adults" type="number" min={1} required defaultValue={stay.adults} />
            <TextField name="children" label="Children" type="number" min={0} defaultValue={stay.children} />
            <TextField name="infants" label="Infants" type="number" min={0} defaultValue={stay.infants} />
          </div>
          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
