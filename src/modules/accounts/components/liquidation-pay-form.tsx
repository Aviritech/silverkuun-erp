"use client";

import { Field, Select } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";

/** Accounts picks the account the liquidation is paid from; the request then goes for approval. */
export function LiquidationPayForm({
  action,
  banks,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  banks: { id: string; name: string }[];
}) {
  return (
    <InlineForm action={action} openLabel="Request payment" submitLabel="Raise and submit for approval" variant="primary">
      {(e) => (
        <Field
          label="Pay from"
          error={e.bank_account_id}
          hint="The Branch Manager's approval is the supporting document. Next: a second accountant approves, then Internal Audit, then proof of payment."
        >
          <Select name="bank_account_id" required defaultValue={banks.length === 1 ? banks[0].id : ""}>
            <option value="">Choose the account</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </InlineForm>
  );
}
