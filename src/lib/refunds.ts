/**
 * Refunds (migration 0052): office costs a staff member paid out of their own
 * pocket and claims back. Pure helpers, unit-tested directly.
 */

/** Who pays for office things and claims it back. */
export const REFUND_PEOPLE = ["Jasko", "Tara", "Ann", "Delia", "Dulshan"] as const;

export const REFUND_STATUS = {
  pending: "Waiting",
  refunded: "Refunded",
  rejected: "Declined",
} as const;
export type RefundStatus = keyof typeof REFUND_STATUS;

/** Receipts arrive already shrunk when they are photos; this is the hard ceiling. */
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

const RECEIPT_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** Why a receipt cannot be stored, or null when it can. */
export function receiptProblem(file: { name: string; type: string; size: number }): string | null {
  if (!RECEIPT_EXTENSIONS[file.type]) return `${file.name}: use a photo (JPG, PNG, WebP, HEIC) or a PDF.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_RECEIPT_BYTES) return `${file.name} is larger than 4 MB.`;
  return null;
}

/**
 * Where a claim's receipt lives in the private documents bucket. No documents
 * row points at it, so only staff can read it (0011's bucket policy).
 */
export function receiptPath(refundId: string, type: string, now = Date.now()): string {
  return `refund/${refundId}/${now}-receipt.${RECEIPT_EXTENSIONS[type] ?? "jpg"}`;
}

export const isPdf = (path: string) => path.toLowerCase().endsWith(".pdf");
