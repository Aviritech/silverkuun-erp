"use client";

import { Field, Input, Textarea } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";

export function ReconciliationForm({
  action,
  defaultBalance,
  defaultDate,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaultBalance: string;
  defaultDate: string;
}) {
  return (
    <InlineForm action={action} openLabel="Prepare reconciliation" submitLabel="Save reconciliation" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Statement date" error={e.period_end}>
            <Input name="period_end" type="date" defaultValue={defaultDate} max={new Date().toISOString().slice(0, 10)} required />
          </Field>
          <Field label="Closing balance on the statement (₦)" error={e.statement_balance}>
            <Input name="statement_balance" type="number" step="0.01" defaultValue={defaultBalance} required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reconciling items (needed if there's a difference)" error={e.notes}>
              <Textarea name="notes" rows={2} />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}
