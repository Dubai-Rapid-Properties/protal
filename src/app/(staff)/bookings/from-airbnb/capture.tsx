"use client";

import * as React from "react";
import { useActionState } from "react";
import { ClipboardPaste, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/domain/shared";
import { BookmarkletLink, CopyCode } from "@/components/domain/bookmarklet";
import { AirbnbExtensionSetup } from "@/components/domain/airbnb-extension";
import { FormError, FormSection, SelectField, SubmitBar, TextField } from "@/components/domain/form";
import { formatDate } from "@/lib/dates";
import { readAirbnbPage, saveAirbnbReservation, type Capture } from "./actions";

type Unit = { id: string; label: string };

export function AirbnbCapture({ bookmarklet, units }: { bookmarklet: string; units: Unit[] }) {
  const [capture, setCapture] = React.useState<Capture | null>(null);
  const [pasted, setPasted] = React.useState("");
  const [reading, startReading] = React.useTransition();

  const read = React.useCallback((text: string, url: string | null) => {
    startReading(async () => setCapture(await readAirbnbPage(text, url)));
  }, []);

  // Sent by the button: the page's text in the fragment. Read once, then
  // dropped from the address bar and history.
  React.useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    window.history.replaceState(null, "", window.location.pathname);
    try {
      const sent = JSON.parse(decodeURIComponent(hash)) as { u?: string; t?: string };
      if (sent.t) read(sent.t, sent.u ?? null);
    } catch {
      setCapture({ error: "The page could not be read. Try the button again, or paste the page below." });
    }
  }, [read]);

  if (reading) {
    return <p className="text-sm text-[var(--muted-foreground)]">Reading the reservation…</p>;
  }

  if (capture && !("error" in capture)) {
    return <Review capture={capture} units={units} onReset={() => setCapture(null)} />;
  }

  return (
    <div className="space-y-5">
      {capture && "error" in capture && <FormError message={capture.error} />}
      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <AirbnbExtensionSetup
            fallback={
              <>
                <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
                  <li>
                    Show the bookmarks bar: <strong>⌘ + Shift + B</strong> on a Mac (Ctrl + Shift + B on
                    Windows).
                  </li>
                  <li>Drag this button onto the bookmarks bar:</li>
                </ol>
                <BookmarkletLink code={bookmarklet} label="Send to D|R|P" />
                <details className="rounded-md border border-[var(--border)] p-3">
                  <summary className="cursor-pointer font-medium">Dragging does not work? Add it by hand</summary>
                  <div className="mt-3 space-y-3">
                    <CopyCode code={bookmarklet} />
                    <div>
                      <p className="font-medium">Chrome</p>
                      <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
                        <li>
                          Press <strong>⌘ + Option + B</strong> (Bookmark manager).
                        </li>
                        <li>
                          Click <strong>Bookmarks bar</strong> on the left, then the <strong>⋮</strong>{" "}
                          menu at the top right, then <strong>Add new bookmark</strong>.
                        </li>
                        <li>
                          Name: <strong>Send to D|R|P</strong>. URL: paste (<strong>⌘ + V</strong>). Save.
                        </li>
                      </ol>
                    </div>
                    <div>
                      <p className="font-medium">Safari</p>
                      <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
                        <li>
                          On this page press <strong>⌘ + D</strong>, choose <strong>Favorites</strong>, name
                          it <strong>Send to D|R|P</strong> and click Add.
                        </li>
                        <li>
                          Press <strong>⌘ + Option + B</strong>, right-click the new bookmark, choose{" "}
                          <strong>Edit Address</strong> and paste (<strong>⌘ + V</strong>) over it.
                        </li>
                      </ol>
                    </div>
                  </div>
                </details>
                <p className="text-[var(--muted-foreground)]">
                  Then use <strong>Send to D|R|P</strong> on the bookmarks bar wherever the steps below say the D|R|P
                  button.
                </p>
              </>
            }
          />
          <p className="font-medium">Using it</p>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
            <li>Stay signed in to this portal.</li>
            <li>
              On Airbnb open <strong>Reservations</strong>, then the reservation, so its details
              and the host payout are on screen.
            </li>
            <li>
              Click the black <strong>D|R|P Import</strong> button at the bottom right of the page, then{" "}
              <strong>Send reservation</strong>. This page opens with the guest, dates and
              price filled in: check them and save.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <p className="font-medium">Or copy and paste the page</p>
          <p className="text-[var(--muted-foreground)]">
            On the reservation&apos;s page on Airbnb press <strong>⌘ + A</strong>, then{" "}
            <strong>⌘ + C</strong>, and paste it here.
          </p>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder="Paste the Airbnb reservation page here"
            aria-label="Airbnb reservation page"
          />
          <Button type="button" disabled={pasted.trim().length < 20} onClick={() => read(pasted, null)}>
            <ClipboardPaste className="size-4" />
            Read the reservation
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

const val = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function Review({
  capture,
  units,
  onReset,
}: {
  capture: Extract<Capture, { page: unknown }>;
  units: Unit[];
  onReset: () => void;
}) {
  const [state, action] = useActionState(saveAirbnbReservation, {});
  const { page, booking } = capture;
  const datesDiffer =
    booking && page.checkIn && page.checkOut && (booking.checkIn !== page.checkIn || booking.checkOut !== page.checkOut);
  const found = [page.checkIn, page.payout ?? page.roomFee, page.guestName].filter(Boolean).length;

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      {booking ? (
        <Callout tone="info" title={`Booking ${booking.number} in the portal`}>
          Saving adds the guest, the number of guests and the price to it. Its dates stay as the
          Airbnb calendar has them: {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}.
          {datesDiffer &&
            ` The page shows ${formatDate(page.checkIn!)} → ${formatDate(page.checkOut!)}: if Airbnb changed the dates, the next calendar sync moves the booking.`}
        </Callout>
      ) : (
        <Callout tone="info" title="Not in the portal yet">
          Saving adds it as a new Airbnb booking. Its unit and dates are below.
        </Callout>
      )}
      {found < 2 && (
        <Callout tone="warning" title="Little was found on the page">
          Make sure the reservation&apos;s details and host payout were open on Airbnb, then try
          again - or fill in the fields here.
        </Callout>
      )}

      <input type="hidden" name="bookingId" value={booking?.id ?? ""} />
      <FormSection title="Reservation">
        <TextField name="code" label="Confirmation code" defaultValue={page.code ?? ""} placeholder="HM…" />
        {booking ? (
          <>
            <input type="hidden" name="unitId" value={booking.unitId} />
            <input type="hidden" name="checkIn" value={booking.checkIn} />
            <input type="hidden" name="checkOut" value={booking.checkOut} />
            <TextField
              name="unitShown"
              label="Unit"
              value={units.find((u) => u.id === booking.unitId)?.label ?? "—"}
              readOnly
              disabled
            />
          </>
        ) : (
          <>
            <SelectField
              name="unitId"
              label="Unit"
              required
              defaultValue={capture.unitId ?? ""}
              placeholder="Select the unit"
              options={units.map((u) => ({ value: u.id, label: u.label }))}
              hint={capture.unitId ? "Found from the listing's name." : undefined}
            />
            <TextField name="checkIn" label="Check-in" type="date" required defaultValue={page.checkIn ?? ""} />
            <TextField name="checkOut" label="Check-out" type="date" required defaultValue={page.checkOut ?? ""} />
          </>
        )}
      </FormSection>

      <FormSection title="Guest">
        <TextField
          name="guestName"
          label="Guest name"
          defaultValue={page.guestName ?? ""}
          hint={booking?.guestName ? `In the portal now: ${booking.guestName}` : undefined}
        />
        <div className="grid grid-cols-3 gap-4">
          <TextField name="adults" label="Adults" type="number" min="1" defaultValue={val(page.adults ?? 1)} />
          <TextField name="children" label="Children" type="number" min="0" defaultValue={val(page.children ?? 0)} />
          <TextField name="infants" label="Infants" type="number" min="0" defaultValue={val(page.infants ?? 0)} />
        </div>
      </FormSection>

      <FormSection
        title={`Price (${page.currency ?? "AED"})`}
        description="From the host payout on the page. Tourism Dirham is collected by Airbnb from the guest."
        columns={3}
      >
        <TextField name="roomFee" label="Room fee (all nights)" type="number" step="0.01" min="0" defaultValue={val(page.roomFee)} />
        <TextField name="cleaningFee" label="Cleaning fee" type="number" step="0.01" min="0" defaultValue={val(page.cleaningFee)} />
        <TextField name="hostServiceFee" label="Airbnb host fee" type="number" step="0.01" min="0" defaultValue={val(page.hostServiceFee)} />
        <TextField name="occupancyTaxes" label="Tourism Dirham" type="number" step="0.01" min="0" defaultValue={val(page.occupancyTaxes)} />
        <TextField
          name="payout"
          label="Payout (you earn)"
          type="number"
          step="0.01"
          min="0"
          defaultValue={val(page.payout)}
          hint="What Airbnb pays D|R|P"
        />
      </FormSection>
      {page.currency && page.currency !== "AED" && (
        <Callout tone="warning" title={`The page is in ${page.currency}`}>
          The portal keeps amounts in AED. Convert them before saving.
        </Callout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onReset}>
          <RotateCcw className="size-4" />
          Start over
        </Button>
        <SubmitBar label={booking ? `Save to ${booking.number}` : "Add the booking"} />
      </div>
    </form>
  );
}
