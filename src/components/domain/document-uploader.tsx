"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { uploadDocument, type UploadState } from "@/app/documents/actions";
import { DOCUMENT_KIND, optionsFrom } from "@/lib/labels";
import type { Enums } from "@/lib/db/database.types";

/**
 * Document kinds that carry a statutory expiry. Selecting one of these makes
 * the expiry field required, which is what keeps the compliance calendar
 * complete rather than half-populated.
 *
 * A management agreement is not one of them: many run until either side ends
 * them, and its renewal date (if any) lives on the agreement itself
 * (management_agreements.end_date), which is what the compliance calendar reads.
 */
const EXPIRING_KINDS = new Set<Enums<"document_kind">>([
  "ejari_certificate",
  "det_permit",
  "building_noc",
  "insurance_policy",
  "emirates_id",
  "passport",
  "visa",
  "trade_licence",
]);

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Uploading…" : "Upload document"}
    </Button>
  );
}

export function DocumentUploader({
  entityKind,
  entityId,
  unitId,
  ownerId,
  onDone,
}: {
  entityKind: Enums<"document_entity">;
  entityId?: string;
  unitId?: string;
  ownerId?: string;
  onDone?: () => void;
}) {
  const [state, action] = useActionState<UploadState, FormData>(uploadDocument, {});
  const [kind, setKind] = React.useState<Enums<"document_kind">>("other");
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      formRef.current?.reset();
      onDone?.();
    }
    if (state.error) toast.error(state.error);
  }, [state, onDone]);

  const expiryRequired = EXPIRING_KINDS.has(kind);

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-4 rounded-lg border border-dashed border-[var(--border)] p-4"
    >
      <input type="hidden" name="entityKind" value={entityKind} />
      {entityId && <input type="hidden" name="entityId" value={entityId} />}
      {unitId && <input type="hidden" name="unitId" value={unitId} />}
      {ownerId && <input type="hidden" name="ownerId" value={ownerId} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="file">File</Label>
          <Input
            id="file"
            name="file"
            type="file"
            required
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx"
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            PDF, image or Office document, up to 25 MB.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="kind">Document type</Label>
          <Select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as Enums<"document_kind">)}
          >
            {optionsFrom(DOCUMENT_KIND).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required placeholder="e.g. Ejari certificate 2026" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="referenceNumber">Reference number</Label>
          <Input
            id="referenceNumber"
            name="referenceNumber"
            placeholder="Certificate / permit / policy number"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="issuedOn">Issued on</Label>
          <Input id="issuedOn" name="issuedOn" type="date" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expiresOn">
            Expires on{" "}
            {expiryRequired && <span className="text-[var(--destructive)]">*</span>}
          </Label>
          <Input
            id="expiresOn"
            name="expiresOn"
            type="date"
            required={expiryRequired}
          />
          {expiryRequired && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Feeds the renewal calendar and the 60/30/7 day alerts.
            </p>
          )}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Visibility</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isOwnerVisible" defaultChecked className="size-4" />
          Visible to the owner in their portal
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isTenantVisible" className="size-4" />
          Visible to the tenant or guest
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isSensitive" className="size-4" />
          Restricted — ID copies, bank letters and similar. Staff access limited to
          admin, property managers and finance.
        </label>
      </fieldset>

      <div className="flex gap-2">
        <SubmitButton />
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
