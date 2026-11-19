"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function CloseDayForm({ action, businessDate, label, warning }: { action: Action; businessDate: string; label: string; warning?: string }) {
  return (
    <InlineForm action={action} openLabel={label} submitLabel={`Yes, ${label.charAt(0).toLowerCase()}${label.slice(1)}`} variant="primary">
      {(e) => (
        <>
          <input type="hidden" name="business_date" value={businessDate} />
          <p className="text-sm text-zinc-700">
            Nothing more can be posted to this day once it is closed. Anything posted later goes on the next business day, and mistakes are put
            right with a reversal.
          </p>
          {warning && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p>}
          <Field label="Note (optional)" error={e.note}>
            <Textarea name="note" rows={2} placeholder="e.g. Cash counted and agreed at all branches" />
          </Field>
        </>
      )}
    </InlineForm>
  );
}

export function DayEndSettingsForm({ action, autoClose, autoCloseAt }: { action: Action; autoClose: boolean; autoCloseAt: string }) {
  return (
    <InlineForm action={action} openLabel="Change" submitLabel="Save" variant="secondary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="If nobody has closed the day">
            <Select name="auto_close" defaultValue={autoClose ? "on" : "off"}>
              <option value="on">The system closes it</option>
              <option value="off">It stays open until someone closes it</option>
            </Select>
          </Field>
          <Field label="At (Lagos time)" error={e.auto_close_at}>
            <Input name="auto_close_at" type="time" defaultValue={autoCloseAt.slice(0, 5)} required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
