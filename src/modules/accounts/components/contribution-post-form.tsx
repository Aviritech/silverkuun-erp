"use client";

import { useActionState } from "react";
import { Button, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

/** Picks the account a verified contribution went into and sends it for confirmation. */
export function ContributionPostForm({
  action,
  banks,
  defaultBankId,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  banks: { id: string; name: string }[];
  defaultBankId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <div className="w-56">
        <Select name="bank_account_id" defaultValue={defaultBankId ?? ""} required aria-label="Paid into">
          <option value="">Paid into…</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="mt-1">
        {pending ? "Sending…" : "Send for confirmation"}
      </Button>
      {(state.error || state.fieldErrors?.bank_account_id) && (
        <span className="w-full text-xs text-red-700">{state.error ?? state.fieldErrors?.bank_account_id}</span>
      )}
    </form>
  );
}
