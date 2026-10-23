"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { FormError, FormSection, SelectField, TextField } from "@/components/domain/form";
import { Button } from "@/components/ui/button";
import { REFUND_PEOPLE } from "@/lib/refunds";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { addRefundReceipt, createRefund } from "../actions";

/** A new claim: who paid, what for, how much, and the receipt. */
export function RefundForm({ defaultPerson, today }: { defaultPerson: string; today: string }) {
  const router = useRouter();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [receipt, setReceipt] = React.useState<{ file: File; preview: string | null } | null>(null);
  const [error, setError] = React.useState<string>();
  const [step, setStep] = React.useState<string | null>(null);

  // Release the thumbnail's memory when it changes or the form goes away.
  React.useEffect(() => () => {
    if (receipt?.preview) URL.revokeObjectURL(receipt.preview);
  }, [receipt]);

  function choose(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setReceipt({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    if (!receipt) {
      setError("Add a photo of the receipt.");
      return;
    }
    setStep("Saving…");
    try {
      const saved = await createRefund(new FormData(e.currentTarget));
      if (!saved.id) {
        setError(saved.error ?? "The claim was not saved.");
        setStep(null);
        return;
      }
      setStep("Uploading the receipt…");
      const data = new FormData();
      data.set("receipt", await shrinkPhoto(receipt.file));
      const result = await addRefundReceipt(saved.id, data).catch(() => ({ error: "The receipt was not uploaded." }));
      if (result.error) toast.warning(`Claim saved, but ${result.error} Add it from the Refunds list.`);
      else toast.success("Refund claim sent.");
      router.push("/refunds");
    } catch {
      setError("The claim was not saved. Check your connection and try again.");
      setStep(null);
    }
  }

  const busy = step !== null;

  return (
    <form onSubmit={submit} className="space-y-5">
      <FormError message={error} />
      <FormSection title="The claim">
        <SelectField
          name="spentBy"
          label="Who paid"
          required
          defaultValue={defaultPerson}
          placeholder="Choose who paid"
          options={REFUND_PEOPLE.map((p) => ({ value: p, label: p }))}
        />
        <TextField name="spentOn" label="Date paid" type="date" required defaultValue={today} max={today} />
        <TextField
          name="description"
          label="What it was for"
          required
          maxLength={500}
          placeholder="e.g. Printer ink for the office"
          wide
        />
        <TextField
          name="amount"
          label="Amount paid (AED)"
          type="number"
          required
          min={0.01}
          step="0.01"
          inputMode="decimal"
        />
      </FormSection>
      <FormSection title="Receipt" description="A clear photo of the receipt, or the PDF." columns={1}>
        {receipt && (
          <div className="relative w-40 overflow-hidden rounded-md border border-[var(--border)]">
            {receipt.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of a chosen file
              <img src={receipt.preview} alt="Receipt" className="aspect-[3/4] w-full object-cover" />
            ) : (
              <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 p-2 text-center text-xs">
                <FileText className="size-8" />
                <span className="break-all">{receipt.file.name}</span>
              </div>
            )}
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="absolute right-1.5 top-1.5 size-7"
              aria-label="Remove the receipt"
              disabled={busy}
              onClick={() => setReceipt(null)}
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
            {receipt ? "Choose another" : "Add receipt"}
          </Button>
          <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
            On a phone you can take the photo with the camera.
          </p>
        </div>
      </FormSection>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" asChild>
          <Link href="/refunds">Cancel</Link>
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {step ?? "Send claim"}
        </Button>
      </div>
    </form>
  );
}
