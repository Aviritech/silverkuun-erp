"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

/** A single-file upload that resets after success. */
export function UploadForm({
  action,
  label,
  accept = "application/pdf,image/jpeg,image/png",
  submitLabel = "Upload",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  accept?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={formAction} className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
      <Field label={label} error={state.fieldErrors?.file}>
        <Input name="file" type="file" accept={accept} required />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Uploading…" : submitLabel}
      </Button>
      <div className="sm:col-span-2">
        <FormError message={state.error} />
      </div>
    </form>
  );
}
