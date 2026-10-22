"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Clock } from "lucide-react";
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
import { updateStayTimes, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save times"}
    </Button>
  );
}

/** Early check-in / late check-out agreed with the guest. */
export function TimesDialog({
  bookingId,
  checkInTime,
  checkOutTime,
}: {
  bookingId: string;
  checkInTime: string | null;
  checkOutTime: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const submit = React.useMemo(() => updateStayTimes.bind(null, bookingId), [bookingId]);
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
          <Clock className="size-4" />
          Times
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Early check-in / late check-out</DialogTitle>
            <DialogDescription>
              Leave empty for the standard times: check-in from 15:00, check-out by 12:00. The
              check-in and check-out alarms ring an hour before and at these times, and the
              cleaning starts at the check-out time.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            <TextField
              name="checkInTime"
              label="Check-in time"
              type="time"
              defaultValue={checkInTime?.slice(0, 5) ?? ""}
              hint="Standard 15:00"
            />
            <TextField
              name="checkOutTime"
              label="Check-out time"
              type="time"
              defaultValue={checkOutTime?.slice(0, 5) ?? ""}
              hint="Standard 12:00"
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
