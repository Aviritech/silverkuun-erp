"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { EMPLOYMENT_TYPES, ID_TYPES, MARITAL_STATUSES } from "../constants";
import type { Department, Employee, JobTitle } from "../queries";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  employee?: Partial<Employee>;
  /** Only for a new starter: where they'll work. Afterwards these change through job changes. */
  placement?: {
    branches: { id: string; name: string }[];
    departments: Department[];
    jobTitles: JobTitle[];
    /** The Head of HR may enter existing, already-confirmed staff as active. */
    canEnterActive: boolean;
  };
  /** The work email is the sign-in name once a login exists. */
  lockWorkEmail?: boolean;
  submitLabel: string;
};

function Options({ choices }: { choices: Record<string, string> }) {
  return Object.entries(choices).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

export function EmployeeForm({ action, employee = {}, placement, lockWorkEmail, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <FormError message={state.error} />

      {placement && (
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-zinc-700">Job</legend>
          <Field label="Branch" error={e.branch_id}>
            <Select name="branch_id" defaultValue={placement.branches.length === 1 ? placement.branches[0].id : ""} required>
              <option value="">Choose a branch</option>
              {placement.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department" error={e.department_code}>
            <Select name="department_code" defaultValue="" required>
              <option value="">Choose a department</option>
              {placement.departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Job title" error={e.job_title_id} hint="Leave requests are routed by job title">
            <Select name="job_title_id" defaultValue="" required>
              <option value="">Choose a job title</option>
              {placement.jobTitles
                .filter((t) => t.is_active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Employee number" error={e.employee_no} hint="Leave blank to number them automatically">
            <Input name="employee_no" placeholder="SK-00042" />
          </Field>
          {placement.canEnterActive && (
            <Field label="Status" error={e.status} hint="Choose Active for staff who were confirmed before the ERP">
              <Select name="status" defaultValue="probation">
                <option value="probation">New starter, on probation</option>
                <option value="active">Already confirmed</option>
              </Select>
            </Field>
          )}
        </fieldset>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Employment</legend>
        <Field label="Employment type" error={e.employment_type}>
          <Select name="employment_type" defaultValue={employee.employment_type ?? "permanent"} required>
            <Options choices={EMPLOYMENT_TYPES} />
          </Select>
        </Field>
        <Field label="Hire date" error={e.hire_date}>
          <Input name="hire_date" type="date" defaultValue={employee.hire_date ?? ""} required />
        </Field>
        <Field label="Probation ends" error={e.probation_end_date}>
          <Input name="probation_end_date" type="date" defaultValue={employee.probation_end_date ?? ""} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Personal details</legend>
        <Field label="Title" error={e.title}>
          <Input name="title" defaultValue={employee.title ?? ""} placeholder="Mr, Mrs, Dr…" />
        </Field>
        <Field label="First name" error={e.first_name}>
          <Input name="first_name" defaultValue={employee.first_name ?? ""} required />
        </Field>
        <Field label="Middle name" error={e.middle_name}>
          <Input name="middle_name" defaultValue={employee.middle_name ?? ""} />
        </Field>
        <Field label="Last name" error={e.last_name}>
          <Input name="last_name" defaultValue={employee.last_name ?? ""} required />
        </Field>
        <Field label="Date of birth" error={e.date_of_birth}>
          <Input name="date_of_birth" type="date" defaultValue={employee.date_of_birth ?? ""} />
        </Field>
        <Field label="Gender" error={e.gender}>
          <Select name="gender" defaultValue={employee.gender ?? ""}>
            <option value="">Not given</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </Field>
        <Field label="Marital status" error={e.marital_status}>
          <Select name="marital_status" defaultValue={employee.marital_status ?? ""}>
            <option value="">Not given</option>
            <Options choices={MARITAL_STATUSES} />
          </Select>
        </Field>
        <Field label="State of origin" error={e.state_of_origin}>
          <Input name="state_of_origin" defaultValue={employee.state_of_origin ?? ""} />
        </Field>
        <Field label="Nationality" error={e.nationality}>
          <Input name="nationality" defaultValue={employee.nationality ?? "Nigerian"} />
        </Field>
        <Field label="Phone" error={e.phone}>
          <Input name="phone" type="tel" defaultValue={employee.phone ?? ""} required />
        </Field>
        <Field label="Personal email" error={e.personal_email}>
          <Input name="personal_email" type="email" defaultValue={employee.personal_email ?? ""} />
        </Field>
        <Field
          label="Work email"
          error={e.work_email}
          hint={lockWorkEmail ? "Their sign-in name; it can't be changed here" : "Needed for an ERP login"}
        >
          <Input name="work_email" type="email" defaultValue={employee.work_email ?? ""} readOnly={lockWorkEmail} />
        </Field>
        <div className="sm:col-span-4">
          <Field label="Residential address" error={e.address}>
            <Textarea name="address" rows={2} defaultValue={employee.address ?? ""} required />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Identification</legend>
        <Field label="NIN" error={e.nin} hint="11 digits">
          <Input name="nin" inputMode="numeric" maxLength={11} defaultValue={employee.nin ?? ""} />
        </Field>
        <Field label="Means of ID" error={e.id_type}>
          <Select name="id_type" defaultValue={employee.id_type ?? ""}>
            <option value="">Not given</option>
            <Options choices={ID_TYPES} />
          </Select>
        </Field>
        <Field label="ID number" error={e.id_number}>
          <Input name="id_number" defaultValue={employee.id_number ?? ""} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Emergency contact</legend>
        <Field label="Name" error={e.emergency_contact_name}>
          <Input name="emergency_contact_name" defaultValue={employee.emergency_contact_name ?? ""} />
        </Field>
        <Field label="Phone" error={e.emergency_contact_phone}>
          <Input name="emergency_contact_phone" type="tel" defaultValue={employee.emergency_contact_phone ?? ""} />
        </Field>
        <Field label="Relationship" error={e.emergency_contact_relationship}>
          <Input name="emergency_contact_relationship" defaultValue={employee.emergency_contact_relationship ?? ""} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Pay details</legend>
        <Field label="Bank" error={e.bank_name}>
          <Input name="bank_name" defaultValue={employee.bank_name ?? ""} />
        </Field>
        <Field label="Account number" error={e.bank_account_number} hint="10-digit NUBAN">
          <Input name="bank_account_number" inputMode="numeric" maxLength={10} defaultValue={employee.bank_account_number ?? ""} />
        </Field>
        <Field label="Tax ID (TIN)" error={e.tax_id}>
          <Input name="tax_id" defaultValue={employee.tax_id ?? ""} />
        </Field>
        <Field label="Pension fund administrator" error={e.pension_administrator}>
          <Input name="pension_administrator" defaultValue={employee.pension_administrator ?? ""} />
        </Field>
        <Field label="Pension PIN (RSA)" error={e.pension_pin}>
          <Input name="pension_pin" defaultValue={employee.pension_pin ?? ""} />
        </Field>
        <Field
          label="Annual rent (₦)"
          error={e.annual_rent}
          hint="For rent relief: 20% of annual rent up to ₦500,000; keep the tenancy agreement on file"
        >
          <Input name="annual_rent" type="number" min="0" step="0.01" defaultValue={employee.annual_rent ?? ""} />
        </Field>
        <div className="space-y-2 pt-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="pension_applies" defaultChecked={employee.pension_applies ?? true} className="h-4 w-4 rounded border-zinc-300" />
            Deduct pension
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="nhf_applies" defaultChecked={employee.nhf_applies ?? true} className="h-4 w-4 rounded border-zinc-300" />
            Deduct National Housing Fund
          </label>
          {(e.pension_applies || e.nhf_applies) && <p className="text-xs text-red-700">{e.pension_applies ?? e.nhf_applies}</p>}
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
