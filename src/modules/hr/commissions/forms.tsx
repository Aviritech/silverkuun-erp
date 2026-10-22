"use client";

import { useActionState, useState } from "react";
import { InlineForm } from "@/components/inline-form";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { COMMISSION_METHODS, type CommissionMethod } from "./constants";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const today = () => new Date().toISOString().slice(0, 10);

type TierRow = { key: number; upto: string; rate: string };

/** Tiered rates as rows: each band runs up to an amount, and the last band covers everything above. */
function TierRows({ error }: { error?: string }) {
  const [rows, setRows] = useState<TierRow[]>([
    { key: 1, upto: "", rate: "" },
    { key: 2, upto: "", rate: "" },
  ]);
  const update = (key: number, patch: Partial<TierRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-zinc-800">Bands</p>
      <p className="text-xs text-zinc-500">
        Each band of sales earns its own rate, like tax bands. The last band covers everything above the band before it.
      </p>
      {rows.map((row, i) => {
        const last = i === rows.length - 1;
        return (
          <div key={row.key} className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <Field label={last ? "Sales" : "Sales up to (₦)"}>
                {last ? (
                  <>
                    <input type="hidden" name="tier_upto" value="" />
                    <p className="mt-1 py-2 text-sm text-zinc-600">{i === 0 ? "All sales" : "And above"}</p>
                  </>
                ) : (
                  <Input name="tier_upto" inputMode="decimal" value={row.upto} onChange={(e) => update(row.key, { upto: e.target.value })} required />
                )}
              </Field>
            </div>
            <div className="w-28">
              <Field label="Rate (%)">
                <Input name="tier_rate" inputMode="decimal" value={row.rate} onChange={(e) => update(row.key, { rate: e.target.value })} required />
              </Field>
            </div>
            {rows.length > 1 && (
              <Button type="button" variant="secondary" onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
                Remove
              </Button>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        onClick={() => setRows((rs) => [...rs.slice(0, -1), { key: Date.now(), upto: "", rate: "" }, rs[rs.length - 1]])}
      >
        Add a band
      </Button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function TargetForm({
  action,
  employees,
}: {
  action: Action;
  employees: { id: string; full_name: string; employee_no: string; branch_name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [method, setMethod] = useState<CommissionMethod | "">("");
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee" error={e.employee_id}>
          <Select name="employee_id" defaultValue="" required>
            <option value="">Choose</option>
            {employees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.employee_no}, {p.branch_name})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" error={e.name} hint="For example, “Q1 2027 loans”">
          <Input name="name" required />
        </Field>
        <Field label="Period starts" error={e.period_start}>
          <Input name="period_start" type="date" required />
        </Field>
        <Field label="Period ends" error={e.period_end}>
          <Input name="period_end" type="date" required />
        </Field>
        <Field label="Target (₦)" error={e.target_amount} hint="Total approved sales the employee is aiming for">
          <Input name="target_amount" inputMode="decimal" required />
        </Field>
        <Field label="How commission is worked out" error={e.method}>
          <Select name="method" value={method} onChange={(ev) => setMethod(ev.target.value as CommissionMethod)} required>
            <option value="">Choose</option>
            {Object.entries(COMMISSION_METHODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {(method === "percent_of_sales" || method === "percent_of_target_if_met") && (
          <Field
            label="Rate (%)"
            error={e.rate}
            hint={method === "percent_of_sales" ? "Paid on every approved sale" : "Paid on the target amount, once it is met"}
          >
            <Input name="rate" inputMode="decimal" required />
          </Field>
        )}
        {method === "flat_if_met" && (
          <Field label="Amount paid if the target is met (₦)" error={e.flat_amount}>
            <Input name="flat_amount" inputMode="decimal" required />
          </Field>
        )}
      </div>
      {method === "tiered" && <TierRows error={e.tiers} />}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set target"}
      </Button>
    </form>
  );
}

export function SaleForm({ action, period, label = "Record a sale" }: { action: Action; period: { start: string; end: string }; label?: string }) {
  const max = period.end < today() ? period.end : today();
  return (
    <InlineForm action={action} openLabel={label} submitLabel="Record sale" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client" error={e.client_name}>
            <Input name="client_name" required />
          </Field>
          <Field label="Amount (₦)" error={e.amount}>
            <Input name="amount" inputMode="decimal" required />
          </Field>
          <Field label="Date of sale" error={e.sale_date} hint="Within the target's period, and not in the future">
            <Input name="sale_date" type="date" min={period.start} max={max} defaultValue={max} required />
          </Field>
          <Field label="Reference" error={e.reference} hint="Loan number, receipt or invoice, if there is one">
            <Input name="reference" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="What was sold" error={e.description}>
              <Textarea name="description" rows={2} />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function RejectSaleForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Reject" submitLabel="Reject sale" variant="danger">
      {(e) => (
        <Field label="Why are you rejecting it?" error={e.note}>
          <Textarea name="note" rows={2} required />
        </Field>
      )}
    </InlineForm>
  );
}
