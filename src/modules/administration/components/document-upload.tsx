"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { ActionState } from "../actions";
import { DOCUMENT_TYPES } from "../constants";

export function DocumentUpload({ action }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={formAction} className="grid items-end gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
      <Field label="Document" error={state.fieldErrors?.document_type}>
        <Select name="document_type" required defaultValue="">
          <option value="">Choose</option>
          {Object.entries(DOCUMENT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
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
