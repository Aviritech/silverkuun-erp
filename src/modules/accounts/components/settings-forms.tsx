"use client";

import { Field, Input, Select } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";
import { ACCOUNT_TYPES, CASH_FLOW_CLASSES } from "../constants";
import type { LedgerAccount, PostingRule } from "../queries";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function AccountSelect({ name, accounts, defaultValue, allowNone }: { name: string; accounts: LedgerAccount[]; defaultValue?: string | null; allowNone?: string }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? ""}>
      <option value="">{allowNone ?? "Choose"}</option>
      {accounts.map((a) => (
        <option key={a.code} value={a.code}>
          {a.code} {a.name}
        </option>
      ))}
    </Select>
  );
}

export function LedgerAccountForm({ action, groups }: { action: Action; groups: LedgerAccount[] }) {
  return (
    <InlineForm action={action} openLabel="Add account" submitLabel="Add account" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Code (4 digits)" error={e.code}>
            <Input name="code" required pattern="\d{4}" />
          </Field>
          <Field label="Name" error={e.name}>
            <Input name="name" required />
          </Field>
          <Field label="Under heading" error={e.parent_code}>
            <AccountSelect name="parent_code" accounts={groups} />
          </Field>
          <Field label="Type (must match the heading)" error={e.account_type}>
            <Select name="account_type" defaultValue="expense">
              {Object.entries(ACCOUNT_TYPES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cash flow" error={e.cash_flow_class} hint="Choose “Cash or bank” for a new bank account's ledger.">
            <Select name="cash_flow_class" defaultValue="operating">
              {Object.entries(CASH_FLOW_CLASSES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What goes here" error={e.description}>
            <Input name="description" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function BankAccountForm({ action, branches, cashAccounts }: { action: Action; branches: { id: string; name: string }[]; cashAccounts: LedgerAccount[] }) {
  return (
    <InlineForm action={action} openLabel="Add bank or cash account" submitLabel="Add account" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Branch" error={e.branch_id}>
            <Select name="branch_id" defaultValue="">
              <option value="">Choose</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" error={e.name}>
            <Input name="name" required placeholder="e.g. Access Bank Port Harcourt" />
          </Field>
          <Field label="Kind" error={e.kind}>
            <Select name="kind" defaultValue="bank">
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
            </Select>
          </Field>
          <Field label="Bank" error={e.bank_name}>
            <Input name="bank_name" />
          </Field>
          <Field label="Account number" error={e.account_number}>
            <Input name="account_number" />
          </Field>
          <Field label="Ledger account" error={e.ledger_account_code} hint="Each bank account needs its own ledger account under 1130.">
            <AccountSelect name="ledger_account_code" accounts={cashAccounts} />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function PostingRuleForm({ action, rule, accounts }: { action: Action; rule: PostingRule; accounts: LedgerAccount[] }) {
  return (
    <InlineForm action={action} openLabel="Change" submitLabel="Save rule" variant="secondary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-4">
          {rule.direction === "payment" ? (
            <Field label="Debit" error={e.debit_account}>
              <AccountSelect name="debit_account" accounts={accounts} defaultValue={rule.debit_account} />
            </Field>
          ) : (
            <>
              <Field label="Credit" error={e.credit_account}>
                <AccountSelect name="credit_account" accounts={accounts} defaultValue={rule.credit_account} />
              </Field>
              <Field label="Interest to (loan repayments)" error={e.interest_account}>
                <AccountSelect name="interest_account" accounts={accounts} defaultValue={rule.interest_account} allowNone="No interest split" />
              </Field>
            </>
          )}
          <Field label="In use" error={e.is_active}>
            <Select name="is_active" defaultValue={String(rule.is_active)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function CategorisationRuleForm({ action, rules }: { action: Action; rules: PostingRule[] }) {
  return (
    <InlineForm action={action} openLabel="Add keyword" submitLabel="Add keyword" variant="secondary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="When the statement description contains" error={e.pattern}>
            <Input name="pattern" required placeholder="e.g. COT CHARGE" />
          </Field>
          <Field label="Suggest" error={e.transaction_type}>
            <Select name="transaction_type" defaultValue="">
              <option value="">Choose</option>
              {rules.map((r) => (
                <option key={r.transaction_type} value={r.transaction_type}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
