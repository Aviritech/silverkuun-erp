"use client";

import { useState } from "react";
import { InlineForm } from "@/components/inline-form";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";
import { ADJUSTMENT_KINDS, COMPONENT_KEYS, DEDUCTION_KINDS, SALARY_COMPONENTS } from "../constants";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function Options({ choices }: { choices: Record<string, string> }) {
  return Object.entries(choices).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

/** "2026-03-01" → "2026-03", for month inputs. */
const toMonth = (date: string) => date.slice(0, 7);

export function PrepareRunForm({ action, defaultMonth, maxMonth }: { action: Action; defaultMonth: string; maxMonth: string }) {
  return (
    <InlineForm action={action} openLabel="Prepare payroll" submitLabel="Prepare" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Month" error={e.period}>
            <Input name="period" type="month" defaultValue={toMonth(defaultMonth)} max={toMonth(maxMonth)} required />
          </Field>
          <Field label="Note (optional)" error={e.note}>
            <Input name="note" placeholder="For example, includes the mid-year bonus" />
          </Field>
          <p className="text-xs text-zinc-500 sm:col-span-2">
            Everyone with an approved salary is added, with their deductions and any approved commission. You can add bonuses and
            one-off deductions before you submit it.
          </p>
        </div>
      )}
    </InlineForm>
  );
}

export function AdjustmentForm({ action, employees }: { action: Action; employees: { id: string; label: string }[] }) {
  const [kind, setKind] = useState("");
  return (
    <InlineForm action={action} openLabel="Add adjustment" submitLabel="Add">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" error={e.employee_id}>
            <Select name="employee_id" defaultValue="" required>
              <option value="">Choose an employee</option>
              {employees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kind" error={e.kind}>
            <Select name="kind" value={kind} onChange={(ev) => setKind(ev.target.value)} required>
              <option value="">Choose</option>
              <Options choices={ADJUSTMENT_KINDS} />
            </Select>
          </Field>
          <Field label="Description" error={e.description} hint="Shown on the payslip">
            <Input name="description" required />
          </Field>
          <Field label="Amount (₦)" error={e.amount}>
            <Input name="amount" type="number" min="0.01" step="0.01" required />
          </Field>
          {kind !== "deduction" && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="taxable" defaultChecked className="h-4 w-4 rounded border-zinc-300" />
              Taxable (untick for a reimbursement of expenses)
            </label>
          )}
        </div>
      )}
    </InlineForm>
  );
}

export function SalaryForm({ action, defaultMonth }: { action: Action; defaultMonth: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const total = COMPONENT_KEYS.reduce((sum, k) => sum + (Number(values[k]) || 0), 0);
  return (
    <InlineForm action={action} openLabel="Propose a salary" submitLabel="Propose" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Starts from" error={e.effective_from} hint="Salaries start on the first of a month">
            <Input name="effective_from" type="month" defaultValue={toMonth(defaultMonth)} required />
          </Field>
          <div className="sm:col-span-2" />
          {COMPONENT_KEYS.map((k) => (
            <Field key={k} label={`${SALARY_COMPONENTS[k]} (₦ a month)`} error={e[k]}>
              <Input
                name={k}
                type="number"
                min={k === "basic" ? "0.01" : "0"}
                step="0.01"
                defaultValue={k === "basic" ? "" : "0"}
                required={k === "basic"}
                onChange={(ev) => setValues((v) => ({ ...v, [k]: ev.target.value }))}
              />
            </Field>
          ))}
          <p className="text-sm sm:col-span-3">
            Total monthly pay: <strong className="tabular-nums">{formatMoney(total)}</strong>
          </p>
          <div className="sm:col-span-3">
            <Field label="Reason" error={e.reason} hint="For example, appointment, promotion or annual review">
              <Textarea name="reason" rows={2} required />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function DeductionForm({ action, defaultMonth }: { action: Action; defaultMonth: string }) {
  return (
    <InlineForm action={action} openLabel="Add deduction" submitLabel="Add">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Kind" error={e.kind}>
            <Select name="kind" defaultValue="" required>
              <option value="">Choose</option>
              <Options choices={DEDUCTION_KINDS} />
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" error={e.description} hint="Shown on the payslip">
              <Input name="description" required />
            </Field>
          </div>
          <Field label="Each month (₦)" error={e.monthly_amount}>
            <Input name="monthly_amount" type="number" min="0.01" step="0.01" required />
          </Field>
          <Field label="Total to recover (₦)" error={e.total_amount} hint="Optional. It stops once this much is recovered">
            <Input name="total_amount" type="number" min="0.01" step="0.01" />
          </Field>
          <div />
          <Field label="First month" error={e.start_month}>
            <Input name="start_month" type="month" defaultValue={toMonth(defaultMonth)} required />
          </Field>
          <Field label="Last month" error={e.end_month} hint="Optional">
            <Input name="end_month" type="month" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

type Band = { upto: string; rate: string };

export type SettingsValues = {
  effective_from: string;
  pension_employee_rate: number;
  pension_employer_rate: number;
  nhf_rate: number;
  rent_relief_rate: number;
  rent_relief_cap: number;
  paye_bands: { upto: number | null; rate: number }[];
  note: string | null;
};

/** Adds a new version of the rates and bands, or edits one that no approved payroll has used. */
export function SettingsForm({
  action,
  initial,
  editing,
  openLabel,
}: {
  action: Action;
  initial: SettingsValues;
  /** When editing, the start month is fixed. */
  editing: boolean;
  openLabel: string;
}) {
  const [bands, setBands] = useState<Band[]>(
    initial.paye_bands.map((b) => ({ upto: b.upto === null ? "" : String(b.upto), rate: String(b.rate) })),
  );
  const update = (i: number, change: Partial<Band>) => setBands((all) => all.map((b, j) => (j === i ? { ...b, ...change } : b)));

  return (
    <InlineForm action={action} openLabel={openLabel} submitLabel="Save settings" variant={editing ? "secondary" : "primary"}>
      {(e) => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Starts from" error={e.effective_from} hint={editing ? "Can't change; add a new version instead" : undefined}>
              <Input
                name="effective_from"
                type="month"
                defaultValue={toMonth(initial.effective_from)}
                readOnly={editing}
                disabled={editing}
                required
              />
            </Field>
            <Field label="Employee pension (%)" error={e.pension_employee_rate} hint="Of basic, housing and transport">
              <Input name="pension_employee_rate" type="number" min="0" max="100" step="0.01" defaultValue={initial.pension_employee_rate} required />
            </Field>
            <Field label="Employer pension (%)" error={e.pension_employer_rate} hint="Of basic, housing and transport">
              <Input name="pension_employer_rate" type="number" min="0" max="100" step="0.01" defaultValue={initial.pension_employer_rate} required />
            </Field>
            <Field label="NHF (%)" error={e.nhf_rate} hint="Of basic">
              <Input name="nhf_rate" type="number" min="0" max="100" step="0.01" defaultValue={initial.nhf_rate} required />
            </Field>
            <Field label="Rent relief (%)" error={e.rent_relief_rate} hint="Of the annual rent the employee pays">
              <Input name="rent_relief_rate" type="number" min="0" max="100" step="0.01" defaultValue={initial.rent_relief_rate} required />
            </Field>
            <Field label="Rent relief cap (₦ a year)" error={e.rent_relief_cap}>
              <Input name="rent_relief_cap" type="number" min="0" step="0.01" defaultValue={initial.rent_relief_cap} required />
            </Field>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-zinc-800">PAYE bands on annual taxable income</legend>
            <table className="mt-2 w-full max-w-xl text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Income up to (₦)</th>
                  <th className="py-1 pr-3 font-medium">Rate (%)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bands.map((b, i) => {
                  const last = i === bands.length - 1;
                  return (
                    <tr key={i}>
                      <td className="py-1 pr-3">
                        {last ? (
                          <>
                            <input type="hidden" name="band_upto" value="" />
                            <span className="text-zinc-600">and above</span>
                          </>
                        ) : (
                          <Input
                            name="band_upto"
                            type="number"
                            min="1"
                            step="0.01"
                            value={b.upto}
                            onChange={(ev) => update(i, { upto: ev.target.value })}
                            required
                          />
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        <Input
                          name="band_rate"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={b.rate}
                          onChange={(ev) => update(i, { rate: ev.target.value })}
                          required
                        />
                      </td>
                      <td className="py-1">
                        {bands.length > 1 && (
                          <Button type="button" variant="secondary" onClick={() => setBands((all) => all.filter((_, j) => j !== i))}>
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBands((all) => [...all.slice(0, -1), { upto: "", rate: "" }, ...all.slice(-1)])}
              >
                Add a band
              </Button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Lowest band first. The last band has no upper limit.</p>
            {e.paye_bands && <p className="mt-1 text-xs text-red-700">{e.paye_bands}</p>}
          </fieldset>

          <Field label="Note" error={e.note} hint="For example, where the rates come from">
            <Input name="note" defaultValue={initial.note ?? ""} />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
