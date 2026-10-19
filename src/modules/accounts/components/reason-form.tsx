"use client";

import { Field, Textarea } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";

export function ReasonForm({
  action,
  openLabel,
  submitLabel,
  question,
  variant = "danger",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  openLabel: string;
  submitLabel: string;
  question: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <InlineForm action={action} openLabel={openLabel} submitLabel={submitLabel} variant={variant}>
      {(e) => (
        <Field label={question} error={e.reason}>
          <Textarea name="reason" rows={2} required />
        </Field>
      )}
    </InlineForm>
  );
}
