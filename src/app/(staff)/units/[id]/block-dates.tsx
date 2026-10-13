"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarX2, Pencil, UserRound, X } from "lucide-react";
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
import { FormError, SelectField, TextField } from "@/components/domain/form";
import { blockDates, removeBlock, updateBlockNote, type ActionState } from "../../bookings/actions";

const REASONS = [
  { value: "owner_stay", label: "Owner stay" },
  { value: "maintenance", label: "Maintenance" },
  { value: "blocked", label: "Blocked (other)" },
];

function Submit({ label, pending: pendingLabel }: { label: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Blocks dates on the unit. With `startDate`/`endDate` it opens as "Owner
 * stay" for those nights - the way an Airbnb block is recorded as the owner's.
 */
export function BlockDatesDialog({
  unitId,
  startDate,
  endDate,
}: {
  unitId: string;
  startDate?: string;
  endDate?: string;
}) {
  const forOwner = Boolean(startDate && endDate);
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState<ActionState, FormData>(blockDates, {});

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {forOwner ? (
          <Button size="sm" variant="outline">
            <UserRound className="size-4" />
            Owner stay
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <CalendarX2 className="size-4" />
            Block dates
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{forOwner ? "Owner stay" : "Block dates"}</DialogTitle>
            <DialogDescription>
              The unit cannot be booked for these nights. The end date is the first
              night that is free again, like a check-out date.
              {forOwner && " Shorten the dates if only part of the Airbnb block is the owner's."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            <input type="hidden" name="unitId" value={unitId} />
            <SelectField name="reason" label="Reason" required defaultValue="owner_stay" options={REASONS} />
            <div />
            <TextField name="startDate" label="From" type="date" required defaultValue={startDate} />
            <TextField name="endDate" label="Until" type="date" required defaultValue={endDate} />
            <TextField name="note" label="Note" wide placeholder="Owner family visit" />
          </div>
          <DialogFooter>
            <Submit label="Block dates" pending="Saving…" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveBlockButton({ blockId, unitId }: { blockId: string; unitId: string }) {
  // Awaited directly rather than through useActionState: removing the block
  // removes this row, and the toast must still fire after it has gone.
  const [pending, startTransition] = React.useTransition();

  const remove = () => {
    if (!confirm("Remove this block? The dates become bookable again.")) return;
    const formData = new FormData();
    formData.set("blockId", blockId);
    formData.set("unitId", unitId);
    startTransition(async () => {
      const result = await removeBlock({}, formData);
      if (result.error) toast.error(result.error);
      if (result.success) toast.success(result.success);
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label="Remove block"
      disabled={pending}
      onClick={remove}
    >
      <X className="size-4" />
    </Button>
  );
}

/** Adds or edits the note on one block (Airbnb's own notes do not come through its calendar feed). */
export function BlockNoteDialog({
  blockId,
  unitId,
  note,
  label,
}: {
  blockId: string;
  unitId: string;
  note: string | null;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState<ActionState, FormData>(updateBlockNote, {});

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label={note ? "Edit note" : "Add note"}>
          <Pencil className="size-4" />
          <span className="hidden sm:inline">{note ? "Edit note" : "Add note"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{note ? "Edit note" : "Add a note"}</DialogTitle>
            <DialogDescription>
              {label}. Shown on the unit&apos;s calendar for staff. Airbnb&apos;s own calendar notes do not
              come through its calendar link, so copy them here; the sync keeps this note.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <FormError message={state.error} />
            <input type="hidden" name="blockId" value={blockId} />
            <input type="hidden" name="unitId" value={unitId} />
            <TextField name="note" label="Note" defaultValue={note ?? ""} placeholder="Long stay - guest pays directly" />
          </div>
          <DialogFooter>
            <Submit label="Save note" pending="Saving…" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
