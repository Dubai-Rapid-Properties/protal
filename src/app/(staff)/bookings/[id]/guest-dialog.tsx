"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, UserPlus } from "lucide-react";
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
import { updateBookingGuest, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save guest"}
    </Button>
  );
}

export function GuestDialog({
  bookingId,
  isAirbnb,
  guest,
}: {
  bookingId: string;
  isAirbnb: boolean;
  /** The guest on file, or null for a stay synced from the Airbnb calendar. */
  guest: {
    full_name: string;
    phone: string | null;
    email: string | null;
    nationality: string | null;
    passport_number: string | null;
  } | null;
}) {
  const [open, setOpen] = React.useState(false);
  const submit = React.useMemo(() => updateBookingGuest.bind(null, bookingId), [bookingId]);
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
        <Button variant={guest ? "outline" : "default"} size="sm">
          {guest ? <Pencil className="size-4" /> : <UserPlus className="size-4" />}
          {guest ? "Edit" : "Add guest"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{guest ? "Edit guest" : "Add guest"}</DialogTitle>
            <DialogDescription>
              {guest
                ? "Changes apply to this guest on all their stays."
                : isAirbnb
                  ? "Airbnb's calendar feed does not include the guest. Copy the name from the reservation in Airbnb."
                  : "Who is staying."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            <TextField
              name="fullName"
              label="Name"
              required
              wide
              autoComplete="off"
              placeholder="As on the reservation"
              defaultValue={guest?.full_name ?? ""}
            />
            <TextField name="phone" label="Phone" type="tel" defaultValue={guest?.phone ?? ""} />
            <TextField name="email" label="Email" type="email" defaultValue={guest?.email ?? ""} />
            <TextField name="nationality" label="Nationality" defaultValue={guest?.nationality ?? ""} />
            <TextField name="passport" label="Passport" defaultValue={guest?.passport_number ?? ""} />
          </div>
          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
