"use client";

import * as React from "react";
import { Copy, Download, ImageIcon, Loader2, Share2 } from "lucide-react";
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
import { refundImageName } from "@/lib/refunds";
import { drawRefundImage, type RefundForImage } from "@/lib/refund-image";

/**
 * A refunded claim: shows the "Refunded" image, ready to share (WhatsApp on a
 * phone), copy or download for whoever was paid back. Drawn when the dialog
 * opens, so Share runs straight from the tap, as phones require.
 */
export function RefundImageButton({ refund }: { refund: RefundForImage }) {
  const [open, setOpen] = React.useState(false);
  const [image, setImage] = React.useState<{ file: File; url: string } | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | null = null;
    drawRefundImage(refund)
      .then((blob) => {
        if (cancelled) return;
        const file = new File([blob], refundImageName(refund), { type: "image/png" });
        url = URL.createObjectURL(file);
        setImage({ file, url });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setImage(null);
    };
  }, [open, refund]);

  const canShare = image !== null && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [image.file] });
  const canCopy = typeof window !== "undefined" && "ClipboardItem" in window && !!navigator.clipboard?.write;

  async function share() {
    if (!image) return;
    try {
      await navigator.share({ files: [image.file], title: "Refunded" });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error("Could not share. Download it instead.");
    }
  }

  async function copy() {
    if (!image) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image.file })]);
      toast.success("Image copied. Paste it into the chat.");
    } catch {
      toast.error("Could not copy. Download it instead.");
    }
  }

  function download() {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image.url;
    a.download = image.file.name;
    a.click();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setFailed(false);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="mt-1 h-7 px-2 text-xs">
          <ImageIcon className="size-3.5" />
          Image
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Refunded image</DialogTitle>
          <DialogDescription>Send it to {refund.spent_by} to show the money was paid back.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] min-h-48 items-center justify-center overflow-auto rounded-md border bg-[var(--muted)]">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob, not a page asset
            <img src={image.url} alt={`Refunded to ${refund.spent_by}`} className="w-full" />
          ) : failed ? (
            <p className="p-6 text-sm text-[var(--muted-foreground)]">The image could not be made in this browser.</p>
          ) : (
            <Loader2 className="size-6 animate-spin text-[var(--muted-foreground)]" />
          )}
        </div>
        <DialogFooter className="gap-2">
          {canCopy && (
            <Button type="button" variant="outline" disabled={!image} onClick={copy}>
              <Copy className="size-4" />
              Copy
            </Button>
          )}
          <Button type="button" variant={canShare ? "outline" : "default"} disabled={!image} onClick={download}>
            <Download className="size-4" />
            Download
          </Button>
          {canShare && (
            <Button type="button" onClick={share}>
              <Share2 className="size-4" />
              Share
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
