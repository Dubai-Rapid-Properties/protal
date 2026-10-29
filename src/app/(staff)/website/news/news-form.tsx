"use client";

import * as React from "react";
import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormError, FormSection, SubmitBar, TextAreaField, TextField } from "@/components/domain/form";
import { Button } from "@/components/ui/button";
import { addNews, deleteNews, type NewsState } from "./actions";

/** Paste an article's link; the rest fills itself in where the publication allows it. */
export function NewsForm() {
  const [state, action] = useActionState<NewsState, FormData>(addNews, {});
  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);
  // A new, empty form after each article is added; after an error, what was typed stays.
  const v = state.success ? undefined : state.values;

  return (
    <form key={state.added ?? 0} action={action} className="space-y-5">
      <FormError message={state.error} />
      <FormSection
        title="Add an article"
        description="Paste the link to a story from Arabian Business, Lovin Dubai, DXB Interact, Forbes or any other publication. The website shows its headline, a short summary and a link to it."
        columns={1}
      >
        <TextField name="url" label="Article link" type="url" required placeholder="https://www.arabianbusiness.com/…" defaultValue={v?.url} />
        <TextField
          name="title"
          label="Headline"
          defaultValue={v?.title}
          hint="Leave blank to take it from the article. Some sites (Arabian Business, Lovin Dubai) don't allow that: then type it in."
        />
        <TextField name="source" label="Publication" placeholder="Arabian Business" defaultValue={v?.source} />
        <TextAreaField name="summary" label="Summary (optional)" rows={3} defaultValue={v?.summary} hint="One or two sentences, in your own words or the article's first lines." />
        <TextField name="image" label="Image link (optional)" type="url" placeholder="https://…" defaultValue={v?.image} />
        <TextField name="date" label="Date (optional)" type="date" defaultValue={v?.date} hint="Blank: the article's date, or today." />
      </FormSection>
      <div className="flex justify-end">
        <SubmitBar label="Add to the website" />
      </div>
    </form>
  );
}

export function DeleteNewsButton({ id, title }: { id: string; title: string }) {
  const [pending, start] = React.useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove "${title}" from the website?`)) return;
        start(async () => {
          const result = await deleteNews(id);
          if (result.error) toast.error(result.error);
          else toast.success("Removed. The website is rebuilding.");
        });
      }}
    >
      <Trash2 className="size-4" />
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}
