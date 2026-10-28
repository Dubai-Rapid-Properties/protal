"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Enums } from "@/lib/db/database.types";
import { Trash2 } from "lucide-react";
import { changeBookingStatus, deleteBooking, type ActionState } from "../actions";

type Transition = "confirm" | "check_in" | "check_out" | "cancel" | "no_show";

/** Buttons offered for each status; mirrors TRANSITIONS in ../actions. */
const OFFERED: Partial<Record<Enums<"booking_status">, Transition[]>> = {
  inquiry: ["confirm", "cancel"],
  tentative: ["confirm", "cancel"],
  confirmed: ["check_in", "no_show", "cancel"],
  checked_in: ["check_out"],
};

const LABEL: Record<Transition, string> = {
  confirm: "Confirm",
  check_in: "Check in",
  check_out: "Check out",
  cancel: "Cancel booking",
  no_show: "No-show",
};

/** A request made on the Holiday Homes website: the guest's card is held until it is accepted. */
const REQUEST_LABEL: Partial<Record<Transition, string>> = {
  confirm: "Accept request",
  cancel: "Decline request",
};

function ActionButton({ transition, request }: { transition: Transition; request: boolean }) {
  const { pending } = useFormStatus();
  const quiet = transition === "cancel" || transition === "no_show";
  return (
    <Button
      type="submit"
      size="sm"
      variant={transition === "cancel" ? "destructive" : quiet ? "outline" : "default"}
      disabled={pending}
    >
      {(request && REQUEST_LABEL[transition]) || LABEL[transition]}
    </Button>
  );
}

function TransitionForm({
  bookingId,
  transition,
  action,
  request,
}: {
  bookingId: string;
  transition: Transition;
  action: (formData: FormData) => void;
  request: boolean;
}) {
  const reasonRef = React.useRef<HTMLInputElement>(null);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (transition === "confirm" && request) {
          if (!confirm("Accept this request? The guest's card is charged and the stay confirmed.")) e.preventDefault();
        } else if (transition === "cancel") {
          const reason = prompt(
            request
              ? "Decline this request? The hold on the guest's card is released (nothing is charged) and the dates become free again.\n\nReason (optional):"
              : "Cancel this booking? The dates become free again.\n\nReason (optional):"
          );
          if (reason === null) return e.preventDefault();
          if (reasonRef.current) reasonRef.current.value = reason;
        } else if (transition === "no_show" && !confirm("Mark this guest as a no-show?")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="transition" value={transition} />
      <input type="hidden" name="reason" ref={reasonRef} />
      <ActionButton transition={transition} request={request} />
    </form>
  );
}

export function BookingActions({
  bookingId,
  status,
  websiteRequest = false,
}: {
  bookingId: string;
  status: Enums<"booking_status">;
  /** A tentative booking from the Holiday Homes website: a request the team accepts or declines. */
  websiteRequest?: boolean;
}) {
  // One action state for the group: the button that was pressed disappears
  // once the status moves on, so its own state could never show the result.
  const [state, action] = useActionState<ActionState, FormData>(changeBookingStatus, {});

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) toast.success(state.success);
  }, [state]);

  const offered = OFFERED[status] ?? [];
  if (offered.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {offered.map((t) => (
        <TransitionForm key={t} bookingId={bookingId} transition={t} action={action} request={websiteRequest} />
      ))}
    </div>
  );
}

/**
 * Deletes the booking after a confirmation (super admins only; the server
 * refuses once money is recorded against it). An Airbnb stay whose unit is
 * still linked to that calendar would simply be imported again, so the
 * confirmation says so.
 */
export function DeleteBookingButton({
  bookingId,
  bookingNumber,
  reimported,
}: {
  bookingId: string;
  bookingNumber: string;
  reimported: boolean;
}) {
  const [pending, start] = React.useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        const warning = reimported
          ? "\n\nThis stay came from the unit's Airbnb calendar, which is still linked: the next sync will import it again. Remove the Airbnb link on the unit's Calendar tab first, or cancel the reservation on Airbnb."
          : "";
        if (!confirm(`Delete booking ${bookingNumber}? It is removed completely and its dates become free.${warning}`)) return;
        start(async () => {
          const result = await deleteBooking(bookingId);
          if (result?.error) toast.error(result.error);
        });
      }}
    >
      <Trash2 className="size-4" />
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
