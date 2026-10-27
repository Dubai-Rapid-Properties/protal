"use client";

import * as React from "react";
import { Check, FileText, ImagePlus, Loader2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAED } from "@/lib/money";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { addPaymentProof, settleRefund } from "./actions";

/**
 * Super admins: marks a claim refunded with the payment receipt (a transfer
 * screenshot, a photo, a PDF), so whoever claimed sees it was paid. Given
 * `settled`, the claim is already refunded and only the receipt is added.
 */
export function PaidDialog({
  refundId,
  spentBy,
  amount,
  settled = false,
  trigger,
}: {
  refundId: string;
  spentBy: string;
  amount: number | string;
  settled?: boolean;
  trigger: React.ReactNode;
}) {
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [proof, setProof] = React.useState<{ file: File; preview: string | null } | null>(null);
  const [note, setNote] = React.useState("");
  const [step, setStep] = React.useState<string | null>(null);

  // Release the thumbnail's memory when it changes or the dialog goes away.
  React.useEffect(() => () => {
    if (proof?.preview) URL.revokeObjectURL(proof.preview);
  }, [proof]);

  function choose(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setProof({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    if (fileInput.current) fileInput.current.value = "";
  }

  async function save() {
    if (settled && !proof) {
      toast.error("Choose the payment receipt.");
      return;
    }
    try {
      if (!settled) {
        setStep("Saving…");
        const data = new FormData();
        data.set("status", "refunded");
        if (note.trim()) data.set("note", note.trim());
        const result = await settleRefund(refundId, data);
        if (result.error) {
          toast.error(result.error);
          setStep(null);
          return;
        }
      }
      if (proof) {
        setStep("Uploading the receipt…");
        const data = new FormData();
        data.set("proof", await shrinkPhoto(proof.file));
        const result = await addPaymentProof(refundId, data).catch(() => ({ error: "The receipt was not uploaded." }));
        if (result.error) {
          setStep(null);
          if (settled) toast.error(result.error);
          else {
            toast.warning(`Marked as refunded, but ${result.error} Add it from the list.`);
            close();
          }
          return;
        }
      }
      toast.success(settled ? "Payment receipt added." : proof ? "Refunded, with the payment receipt." : "Marked as refunded.");
      close();
    } catch {
      toast.error("Not saved. Check your connection and try again.");
    }
    setStep(null);
  }

  function close() {
    setOpen(false);
    setProof(null);
    setNote("");
  }

  const busy = step !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md text-left">
        <DialogHeader>
          <DialogTitle>{settled ? "Payment receipt" : "Mark as refunded"}</DialogTitle>
          <DialogDescription>
            {formatAED(amount)} paid back to {spentBy}. Add the bank transfer screenshot or the receipt, so {spentBy}{" "}
            can see it was paid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {proof && (
            <div className="relative w-40 overflow-hidden rounded-md border border-[var(--border)]">
              {proof.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of a chosen file
                <img src={proof.preview} alt="Payment receipt" className="aspect-[3/4] w-full object-cover" />
              ) : (
                <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 p-2 text-center text-xs">
                  <FileText className="size-8" />
                  <span className="break-all">{proof.file.name}</span>
                </div>
              )}
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute right-1.5 top-1.5 size-7"
                aria-label="Remove the receipt"
                disabled={busy}
                onClick={() => setProof(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => choose(e.target.files)}
            />
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              <ImagePlus className="size-4" />
              {proof ? "Choose another" : "Add payment receipt"}
            </Button>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              A screenshot, a photo or a PDF{settled ? "." : ". Paid in cash with no receipt? Leave it out."}
            </p>
          </div>
          {!settled && (
            <div className="space-y-1.5">
              <Label htmlFor={`note-${refundId}`}>Note (optional)</Label>
              <Input
                id={`note-${refundId}`}
                value={note}
                maxLength={300}
                placeholder="e.g. Bank transfer"
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" disabled={busy || (settled && !proof)} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {step ?? (settled ? "Save receipt" : "Refunded")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
