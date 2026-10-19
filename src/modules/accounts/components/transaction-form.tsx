"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import type { BankAccount, MemberOption, PostingRule } from "../queries";

export type TransactionDefaults = Partial<{
  transaction_type: string;
  bank_account_id: string;
  txn_date: string;
  amount: string;
  interest_amount: string;
  member_id: string | null;
  counterparty: string | null;
  reference: string | null;
  description: string;
  statement_line_id: string | null;
}>;

export function TransactionForm({
  action,
  direction,
  rules,
  banks,
  members,
  branchName,
  defaults = {},
  withEvidence,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  direction: "receipt" | "payment";
  rules: PostingRule[];
  banks: BankAccount[];
  members: MemberOption[];
  branchName: Map<string, string>;
  defaults?: TransactionDefaults;
  withEvidence: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [type, setType] = useState(defaults.transaction_type ?? "");
  const [bankId, setBankId] = useState(defaults.bank_account_id ?? "");
  const rule = rules.find((r) => r.transaction_type === type);
  const bank = banks.find((b) => b.id === bankId);
  const e = state.fieldErrors ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const memberChoices = bank ? members.filter((m) => m.branch_id === bank.branch_id) : members;

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="statement_line_id" value={defaults.statement_line_id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={direction === "receipt" ? "What was received" : "What is being paid"} error={e.transaction_type}>
          <Select name="transaction_type" required value={type} onChange={(ev) => setType(ev.target.value)}>
            <option value="">Choose</option>
            {rules.map((r) => (
              <option key={r.transaction_type} value={r.transaction_type}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={direction === "receipt" ? "Paid into" : "Paid from"}
          error={e.bank_account_id}
          hint={bank ? `${branchName.get(bank.branch_id)} · ledger ${bank.ledger_account_code}` : undefined}
        >
          <Select name="bank_account_id" required value={bankId} onChange={(ev) => setBankId(ev.target.value)}>
            <option value="">Choose</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({branchName.get(b.branch_id)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={e.txn_date}>
          <Input name="txn_date" type="date" max={today} defaultValue={defaults.txn_date ?? today} required />
        </Field>
        <Field label="Amount (₦)" error={e.amount}>
          <Input name="amount" type="number" min="0.01" step="0.01" defaultValue={defaults.amount} required />
        </Field>
        {rule?.interest_account && (
          <Field label="Of which interest (₦)" error={e.interest_amount} hint="The rest is applied to the loan principal.">
            <Input name="interest_amount" type="number" min="0" step="0.01" defaultValue={defaults.interest_amount ?? ""} />
          </Field>
        )}
        <Field
          label={rule?.requires_member ? "Member" : "Member (optional)"}
          error={e.member_id}
          hint={bank ? "Approved members of the account's branch." : "Choose the account first to narrow this list."}
        >
          <Select name="member_id" defaultValue={defaults.member_id ?? ""} required={rule?.requires_member}>
            <option value="">{rule?.requires_member ? "Choose" : "None"}</option>
            {memberChoices.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.membership_no ? ` (${m.membership_no})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={direction === "receipt" ? "Received from" : "Beneficiary"} error={e.counterparty}>
          <Input name="counterparty" defaultValue={defaults.counterparty ?? ""} />
        </Field>
        <Field label="Reference" error={e.reference} hint="Bank transfer, teller or invoice reference. Must be unique on the account.">
          <Input name="reference" defaultValue={defaults.reference ?? ""} />
        </Field>
      </div>
      <Field label="Description" error={e.description}>
        <Textarea name="description" rows={2} defaultValue={defaults.description ?? ""} required />
      </Field>
      {withEvidence && (
        <Field
          label={direction === "receipt" ? "Evidence (teller, transfer receipt or screenshot)" : "Supporting document (invoice or approval)"}
          error={e.file}
          hint="PDF, JPEG or PNG up to 10 MB. Needed before you submit; you can also add it on the next page."
        >
          <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" />
        </Field>
      )}
      {rule && (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          Posts as: debit {rule.debit_account ?? (bank ? `${bank.ledger_account_code} ${bank.name}` : "the bank account")}, credit{" "}
          {rule.credit_account ?? (bank ? `${bank.ledger_account_code} ${bank.name}` : "the bank account")}
          {rule.interest_account ? `, interest to ${rule.interest_account}` : ""}.
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
