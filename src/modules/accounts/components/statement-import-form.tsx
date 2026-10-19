"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

const COLUMNS = [
  ["date", "Date column", true],
  ["description", "Description / narration column", true],
  ["reference", "Reference column", false],
  ["debit", "Debit (money out) column", true],
  ["credit", "Credit (money in) column", true],
  ["balance", "Balance column", false],
] as const;

/** Uploads a bank statement as Excel (.xlsx) or CSV. Column names are remembered for the account after the first import. */
export function StatementImportForm({
  action,
  mapping,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  mapping: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={form} action={formAction} className="space-y-3">
      <FormError message={state.error} />
      {state.ok && state.message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{state.message}</p>}
      <Field
        label="Statement file (Excel .xlsx or CSV)"
        error={e.file}
        hint="The first sheet is read; rows above the column names are skipped. Lines already imported are skipped."
      >
        <Input
          name="file"
          type="file"
          accept=".xlsx,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
        />
      </Field>
      <details>
        <summary className="cursor-pointer text-sm text-zinc-700">Column names in your bank&apos;s file (saved for next time)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {COLUMNS.map(([name, label, required]) => (
            <Field key={name} label={label} error={e[name]}>
              <Input name={name} defaultValue={mapping[name] ?? ""} required={required} />
            </Field>
          ))}
        </div>
      </details>
      <Button type="submit" disabled={pending}>
        {pending ? "Importing…" : "Import statement"}
      </Button>
    </form>
  );
}
