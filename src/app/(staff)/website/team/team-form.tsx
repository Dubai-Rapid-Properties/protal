"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { ImagePlus, Loader2, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { FormError, FormSection, TextAreaField, TextField } from "@/components/domain/form";
import { Button } from "@/components/ui/button";
import type { TeamRow } from "@/lib/website-team";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { uploadErrorMessage } from "@/lib/upload-error";
import { deleteTeamMember, saveTeamMember, uploadTeamPhoto, type TeamState } from "./actions";

export function TeamForm({
  member,
  photoSrc,
  websiteUrl,
  nextOrder,
}: {
  member?: TeamRow;
  /** The current portrait, ready to show (website paths made absolute) */
  photoSrc: string | null;
  websiteUrl: string;
  nextOrder: number;
}) {
  const [state, action] = useActionState<TeamState, FormData>(saveTeamMember.bind(null, member?.id ?? null), {});
  const [photo, setPhoto] = React.useState<string>(member?.photo_url ?? "");
  const [uploading, setUploading] = React.useState(false);
  const [saving, startSaving] = React.useTransition();
  const [deleting, startDelete] = React.useTransition();
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const preview = photo ? (photo.startsWith("/") ? `${websiteUrl}${photo}` : photo) : null;

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    const data = new FormData();
    data.set("photo", await shrinkPhoto(file));
    try {
      const result = await uploadTeamPhoto(data);
      if (result.url) setPhoto(result.url);
      else toast.error(result.error ?? `${file.name} was not uploaded.`);
    } catch (err) {
      toast.error(uploadErrorMessage(file.name, err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <form
      action={action}
      // Submitted by hand so a refused save keeps everything typed.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startSaving(() => action(data));
      }}
      className="space-y-5"
    >
      <FormError message={state.error} />
      <input type="hidden" name="photoUrl" value={photo} />

      <FormSection title="Person">
        <div className="flex items-center gap-4 sm:col-span-2">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--muted)]">
            {preview ?? photoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview ?? photoSrc!} alt="" className="size-full object-cover object-top" />
            ) : (
              <UserRound className="size-10 text-[var(--muted-foreground)]" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {uploading ? "Uploading…" : photo ? "Change photo" : "Upload photo"}
            </Button>
            {photo && (
              <Button type="button" variant="ghost" onClick={() => setPhoto("")}>
                <X className="size-4" />
                Remove
              </Button>
            )}
          </div>
        </div>
        <TextField name="name" label="Name" required defaultValue={member?.name ?? ""} />
        <TextField name="role" label="Role" placeholder="e.g. Luxury Property Consultant" defaultValue={member?.role ?? ""} />
        <TextField
          name="summary"
          label="Short line"
          wide
          maxLength={200}
          placeholder="One sentence under the role on the About page"
          defaultValue={member?.summary ?? ""}
        />
        <TextAreaField
          name="bio"
          label="Biography"
          rows={6}
          maxLength={10000}
          hint="Leave a blank line between paragraphs. Shown on their profile page."
          defaultValue={member?.bio ?? ""}
        />
      </FormSection>

      <FormSection title="On the website">
        <TextField name="brn" label="RERA BRN" placeholder="e.g. 77282" defaultValue={member?.brn ?? ""} />
        <TextField name="phone" label="Phone (Call button)" placeholder="+971 50 123 4567" defaultValue={member?.phone ?? ""} />
        <TextField name="whatsapp" label="WhatsApp" placeholder="+971 50 123 4567" defaultValue={member?.whatsapp ?? ""} />
        <TextField name="email" label="Email" type="email" defaultValue={member?.email ?? ""} />
        <TextField
          name="agentNames"
          label="Other spellings on Property Finder"
          wide
          placeholder="e.g. Adithya Mitter, Adithya Micheal Mitter"
          hint="Separate with commas. Their Property Finder listings show this card too."
          defaultValue={(member?.agent_names ?? []).join(", ")}
        />
        <TextField
          name="sortOrder"
          label="Order on the About page"
          type="number"
          min="0"
          max="10000"
          hint="Lower numbers come first."
          defaultValue={String(member?.sort_order ?? nextOrder)}
        />
        <div className="space-y-2 text-sm sm:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="showOnAbout" defaultChecked={member?.show_on_about ?? true} className="size-4" />
            Show on the About page, with a profile page
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isActive" defaultChecked={member?.is_active ?? true} className="size-4" />
            Active. Untick when someone leaves: they disappear from the website and from the agent list.
          </label>
        </div>
        <p className="text-xs text-[var(--muted-foreground)] sm:col-span-2">
          Empty phone or WhatsApp: their listings use the D|R|P office numbers instead.
        </p>
      </FormSection>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {member ? (
          <Button
            type="button"
            variant="ghost"
            disabled={deleting}
            className="text-[var(--destructive)]"
            onClick={() => {
              if (!window.confirm(`Delete ${member.name} from the team? They come off the website.`)) return;
              startDelete(async () => {
                const result = await deleteTeamMember(member.id);
                if (result?.error) toast.error(result.error);
              });
            }}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" asChild>
            <Link href="/website/team">Cancel</Link>
          </Button>
          <Button type="submit" disabled={saving || uploading}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Saving…" : member ? "Save" : "Add to the team"}
          </Button>
        </div>
      </div>
    </form>
  );
}
