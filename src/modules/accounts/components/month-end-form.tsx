"use client";

import { Field, Textarea } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function CloseMonthForm({ action, monthEnd, label, warning }: { action: Action; monthEnd: string; label: string; warning?: string }) {
  return (
    <InlineForm action={action} openLabel={label} submitLabel={`Yes, ${label.charAt(0).toLowerCase()}${label.slice(1)}`} variant="primary">
      {(e) => (
        <>
          <input type="hidden" name="month_end" value={monthEnd} />
          <p className="text-sm text-zinc-700">
            Nothing more can be posted into this month once it is closed. Anything posted later with a date in it goes on the first day of the next
            month, and mistakes are put right with a reversal.
          </p>
          {warning && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p>}
          <Field label="Note (optional)" error={e.note}>
            <Textarea name="note" rows={2} placeholder="e.g. All bank accounts reconciled" />
          </Field>
        </>
      )}
    </InlineForm>
  );
}
