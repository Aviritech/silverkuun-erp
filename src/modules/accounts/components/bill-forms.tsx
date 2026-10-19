"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";
import type { LedgerAccount, Supplier, SupplierBill } from "../queries";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function SupplierForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add supplier" submitLabel="Add supplier" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Name" error={e.name}>
            <Input name="name" required />
          </Field>
          <Field label="Contact person" error={e.contact_person}>
            <Input name="contact_person" />
          </Field>
          <Field label="Phone" error={e.phone}>
            <Input name="phone" />
          </Field>
          <Field label="Email" error={e.email}>
            <Input name="email" type="email" />
          </Field>
          <Field label="Bank" error={e.bank_name}>
            <Input name="bank_name" />
          </Field>
          <Field label="Account number" error={e.account_number}>
            <Input name="account_number" inputMode="numeric" />
          </Field>
          <Field label="TIN" error={e.tax_id}>
            <Input name="tax_id" />
          </Field>
          <Field label="Address" error={e.address}>
            <Input name="address" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function BillForm({
  action,
  suppliers,
  branches,
  departments,
  accounts,
  defaults,
  withInvoice,
  submitLabel,
}: {
  action: Action;
  suppliers: Pick<Supplier, "id" | "name" | "is_active">[];
  branches: { id: string; name: string }[];
  departments: { code: string; name: string }[];
  accounts: LedgerAccount[];
  defaults?: Partial<SupplierBill>;
  withInvoice: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier" error={e.supplier_id}>
          <Select name="supplier_id" required defaultValue={defaults?.supplier_id ?? ""}>
            <option value="">Choose</option>
            {suppliers
              .filter((s) => s.is_active || s.id === defaults?.supplier_id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Branch" error={e.branch_id}>
          <Select name="branch_id" required defaultValue={defaults?.branch_id ?? ""} disabled={Boolean(defaults?.id)}>
            <option value="">Choose</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          {defaults?.id && <input type="hidden" name="branch_id" value={defaults.branch_id} />}
        </Field>
        <Field label="Supplier's invoice number" error={e.supplier_reference}>
          <Input name="supplier_reference" required defaultValue={defaults?.supplier_reference ?? ""} />
        </Field>
        <Field label="Amount (₦)" error={e.amount}>
          <Input name="amount" type="number" min="0.01" step="0.01" required defaultValue={defaults?.amount ?? ""} />
        </Field>
        <Field label="Invoice date" error={e.bill_date}>
          <Input name="bill_date" type="date" max={today} required defaultValue={defaults?.bill_date ?? today} />
        </Field>
        <Field label="Due date" error={e.due_date}>
          <Input name="due_date" type="date" required defaultValue={defaults?.due_date ?? today} />
        </Field>
        <Field label="What it's for" error={e.expense_account} hint="The expense or asset account the bill is charged to.">
          <Select name="expense_account" required defaultValue={defaults?.expense_account ?? ""}>
            <option value="">Choose</option>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department (optional)" error={e.department_code}>
          <Select name="department_code" defaultValue={defaults?.department_code ?? ""}>
            <option value="">Not set</option>
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Description" error={e.description}>
        <Textarea name="description" rows={2} required defaultValue={defaults?.description ?? ""} />
      </Field>
      {withInvoice && (
        <Field label="Supplier's invoice (PDF, JPEG or PNG)" error={e.file} hint="Needed before you submit; you can also add it on the next page.">
          <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" />
        </Field>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
