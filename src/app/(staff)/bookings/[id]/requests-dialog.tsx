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
import { FormError, TextAreaField } from "@/components/domain/form";
import { updateSpecialRequests, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

/** What the guest asked for: rings the day before check-in until someone presses Done (0079). */
export function RequestsDialog({ bookingId, requests }: { bookingId: string; requests: string | null }) {
  const [open, setOpen] = React.useState(false);
  const submit = React.useMemo(() => updateSpecialRequests.bind(null, bookingId), [bookingId]);
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
          {requests ? "Edit" : "Add"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Special requests</DialogTitle>
            <DialogDescription>
              What the guest asked for: a crib, spare sheets, extra towels ... From 10:00 the day
              before check-in an alarm rings for super admins and the unit&apos;s housekeeping, in the
              portal and on their phones, until someone presses Done. Changing the requests rings
              it again.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-4">
            <FormError message={state.error} />
            <TextAreaField
              name="specialRequests"
              label="Requests"
              rows={4}
              maxLength={1000}
              defaultValue={requests ?? ""}
              placeholder="Crib. Spare sheets: 3 guests in total."
              hint="Leave empty to remove them."
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
