"use client";

import { useEffect, useRef } from "react";
import { useFormAction } from "@/lib/use-form-action";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { DOCUMENT_TYPES, type DocumentType } from "../constants";
import { withStagedUploads } from "@/lib/uploads/client";

export function DocumentUpload({
  action,
  types,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** The document types offered; letters and statements only make sense once a member is approved. */
  types: DocumentType[];
}) {
  const [state, formAction, pending] = useFormAction(withStagedUploads(action), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} onSubmit={formAction} className="grid items-end gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
      <Field label="Document" error={state.fieldErrors?.document_type}>
        <Select name="document_type" required defaultValue="">
          <option value="">Choose</option>
          {types.map((value) => (
            <option key={value} value={value}>
              {DOCUMENT_TYPES[value]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="File (PDF, JPEG or PNG, up to 10 MB)" error={state.fieldErrors?.file}>
        <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
      <div className="sm:col-span-3">
        <FormError message={state.error} />
      </div>
    </form>
  );
}
