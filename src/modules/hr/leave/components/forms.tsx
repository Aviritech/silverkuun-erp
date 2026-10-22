"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { InlineForm } from "@/components/inline-form";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { APPROVAL_SCOPES, EVIDENCE_TYPES, GENDERS } from "../constants";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function Options({ choices }: { choices: Record<string, string> }) {
  return Object.entries(choices).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-800">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-zinc-300" />
      {label}
    </label>
  );
}

/** Monday to Friday between two dates, less public holidays: the same rule the database uses. */
function workingDays(start: string, end: string, holidays: Set<string>): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
  let count = 0;
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  for (let i = 0; d <= last && i < 400; i++) {
    const iso = d.toISOString().slice(0, 10);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(iso)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

export type LeaveTypeOption = {
  id: string;
  name: string;
  /** Days left this year, or null when the type doesn't use a balance. */
  available: number | null;
  document_after_days: number | null;
};

export type EmployeeOption = { id: string; label: string };
export type ColleagueOption = { id: string; full_name: string; job_title: string; branch_name: string };

/**
 * Asks for leave. For the employee themselves leave `employees` out; HR passes the employees they can record
 * leave for, and may record leave already taken.
 */
export function RequestLeaveForm({
  action,
  leaveTypes,
  colleagues,
  holidays,
  employees,
  minDate,
  submitLabel = "Send request",
}: {
  action: Action;
  leaveTypes: LeaveTypeOption[];
  colleagues: ColleagueOption[];
  holidays: string[];
  employees?: EmployeeOption[];
  minDate?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [typeId, setTypeId] = useState("");
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);

  useEffect(() => {
    if (state.ok) {
      form.current?.reset();
      setStart("");
      setEnd("");
      setTypeId("");
    }
  }, [state]);

  const days = workingDays(start, end || start, holidaySet);
  const type = leaveTypes.find((t) => t.id === typeId);
  const needsDocument = type && type.document_after_days !== null && days !== null && days > type.document_after_days;
  const e = state.fieldErrors ?? {};

  return (
    <form ref={form} action={formAction} className="space-y-4">
      {state.ok && state.message && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.message}
        </p>
      )}
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        {employees && (
          <div className="sm:col-span-3">
            <Field label="Employee" error={e.employee_id}>
              <Select name="employee_id" defaultValue="" required>
                <option value="">Choose</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field label="Kind of leave" error={e.leave_type_id}>
          <Select name="leave_type_id" value={typeId} onChange={(ev) => setTypeId(ev.target.value)} required>
            <option value="">Choose</option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.available !== null ? ` (${t.available} days left)` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="First day off" error={e.start_date}>
          <Input name="start_date" type="date" min={minDate} value={start} onChange={(ev) => setStart(ev.target.value)} required />
        </Field>
        <Field label="Last day off" error={e.end_date}>
          <Input name="end_date" type="date" min={start || minDate} value={end} onChange={(ev) => setEnd(ev.target.value)} required />
        </Field>
      </div>
      <p className="text-xs text-zinc-500">
        {days !== null && start && end
          ? `That is ${days} working ${days === 1 ? "day" : "days"}. `
          : ""}
        Only working days count: weekends and public holidays don&apos;t come off the balance.
        {type?.available !== null && type?.available !== undefined && days !== null && end && days > type.available && (
          <span className="text-red-700"> You have {type.available} days of {type.name.toLowerCase()} left.</span>
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reason" error={e.reason}>
          <Textarea name="reason" rows={2} />
        </Field>
        <Field label="Relief officer" error={e.relief_employee_id} hint="The colleague who covers the work agrees first">
          <Select name="relief_employee_id" defaultValue="">
            <option value="">Nobody</option>
            {colleagues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} · {c.job_title}, {c.branch_name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="Supporting document" error={e.document_type}>
          <Select name="document_type" defaultValue="medical_report">
            <Options choices={EVIDENCE_TYPES} />
          </Select>
        </Field>
        <Field
          label={needsDocument ? "File (needed for this many days)" : "File (optional)"}
          error={e.file}
          hint={
            type?.document_after_days !== null && type?.document_after_days !== undefined
              ? `${type.name} of more than ${type.document_after_days} days needs a document, such as a medical certificate. PDF, JPEG or PNG, up to 10 MB.`
              : "PDF, JPEG or PNG, up to 10 MB"
          }
        >
          <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required={Boolean(needsDocument)} />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : submitLabel}
      </Button>
    </form>
  );
}

export function ApproveStepForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Approve" submitLabel="Approve" variant="primary">
      {(e) => (
        <Field label="Comment (optional)" error={e.comment}>
          <Input name="comment" />
        </Field>
      )}
    </InlineForm>
  );
}

export function RejectStepForm({ action, openLabel = "Turn down" }: { action: Action; openLabel?: string }) {
  return (
    <InlineForm action={action} openLabel={openLabel} submitLabel="Turn down" variant="danger">
      {(e) => (
        <Field label="Reason" error={e.reason} hint="The employee sees this">
          <Textarea name="reason" rows={2} required />
        </Field>
      )}
    </InlineForm>
  );
}

/** The Head of HR's outright decision. A reason is always kept. */
export function DecideForm({ action, approve }: { action: Action; approve: boolean }) {
  return (
    <InlineForm
      action={action}
      openLabel={approve ? "Approve now" : "Turn down now"}
      submitLabel={approve ? "Approve" : "Turn down"}
      variant={approve ? "primary" : "danger"}
    >
      {(e) => (
        <Field
          label="Reason for deciding it directly"
          error={e.reason}
          hint="Steps still waiting are skipped. The employee sees this reason."
        >
          <Textarea name="reason" rows={2} required />
        </Field>
      )}
    </InlineForm>
  );
}

export function CancelLeaveForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Cancel leave" submitLabel="Confirm cancellation" variant="danger">
      {(e) => (
        <Field label="Note (optional)" error={e.reason} hint="The days go back on the balance">
          <Input name="reason" />
        </Field>
      )}
    </InlineForm>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type LeaveTypeValues = {
  name: string;
  days_per_year: number;
  max_days_per_request: number | null;
  document_after_days: number | null;
  extra_days_after_5_years: number;
  extra_days_after_10_years: number;
  is_paid: boolean;
  uses_balance: boolean;
  prorate: boolean;
  only_for_gender: "female" | "male" | null;
};

const NEW_LEAVE_TYPE: LeaveTypeValues = {
  name: "",
  days_per_year: 5,
  max_days_per_request: null,
  document_after_days: null,
  extra_days_after_5_years: 0,
  extra_days_after_10_years: 0,
  is_paid: true,
  uses_balance: true,
  prorate: false,
  only_for_gender: null,
};

export function LeaveTypeForm({ action, values }: { action: Action; values?: LeaveTypeValues }) {
  const v = values ?? NEW_LEAVE_TYPE;
  return (
    <InlineForm
      action={action}
      openLabel={values ? "Edit" : "Add leave type"}
      submitLabel={values ? "Save" : "Add"}
      variant={values ? "secondary" : "primary"}
    >
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" error={e.name}>
            <Input name="name" defaultValue={v.name} required />
          </Field>
          <Field label="Days a year" error={e.days_per_year}>
            <Input name="days_per_year" type="number" min={0} max={366} defaultValue={v.days_per_year} required />
          </Field>
          <Field label="Most days at a time" error={e.max_days_per_request} hint="Blank for no limit">
            <Input name="max_days_per_request" type="number" min={1} defaultValue={v.max_days_per_request ?? ""} />
          </Field>
          <Field label="Document needed after" error={e.document_after_days} hint="Days; blank if never needed">
            <Input name="document_after_days" type="number" min={0} defaultValue={v.document_after_days ?? ""} />
          </Field>
          <Field label="Extra days after 5 years" error={e.extra_days_after_5_years}>
            <Input name="extra_days_after_5_years" type="number" min={0} defaultValue={v.extra_days_after_5_years} required />
          </Field>
          <Field label="Extra days after 10 years" error={e.extra_days_after_10_years} hint="Instead of the 5-year extra">
            <Input name="extra_days_after_10_years" type="number" min={0} defaultValue={v.extra_days_after_10_years} required />
          </Field>
          <Field label="Who can take it" error={e.only_for_gender}>
            <Select name="only_for_gender" defaultValue={v.only_for_gender ?? ""}>
              <option value="">Everyone</option>
              <Options choices={GENDERS} />
            </Select>
          </Field>
          <div className="space-y-2 sm:col-span-2 sm:pt-6">
            <Checkbox name="is_paid" label="Paid" defaultChecked={v.is_paid} />
            <Checkbox name="uses_balance" label="Comes out of a yearly balance" defaultChecked={v.uses_balance} />
            <Checkbox name="prorate" label="New starters get a share for the months left in the year" defaultChecked={v.prorate} />
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export type ApprovalStepValues = {
  name: string;
  job_title_ids: string[];
  scope: keyof typeof APPROVAL_SCOPES;
  same_department: boolean;
};

export function ApprovalStepForm({
  action,
  values,
  jobTitles,
}: {
  action: Action;
  values?: ApprovalStepValues;
  jobTitles: { id: string; name: string; is_active: boolean }[];
}) {
  const chosen = new Set(values?.job_title_ids ?? []);
  return (
    <InlineForm
      action={action}
      openLabel={values ? "Edit" : "Add step"}
      submitLabel={values ? "Save" : "Add step"}
      variant={values ? "secondary" : "primary"}
    >
      {(e) => (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Step name" error={e.name}>
              <Input name="name" defaultValue={values?.name} placeholder="For example, Branch Manager" required />
            </Field>
            <Field label="The approver works" error={e.scope}>
              <Select name="scope" defaultValue={values?.scope ?? "branch"} required>
                <Options choices={APPROVAL_SCOPES} />
              </Select>
            </Field>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-zinc-800">Job titles that can approve</legend>
            <div className="mt-1 grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 sm:grid-cols-2">
              {jobTitles
                .filter((t) => t.is_active || chosen.has(t.id))
                .map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="job_title_ids"
                      value={t.id}
                      defaultChecked={chosen.has(t.id)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    {t.name}
                  </label>
                ))}
            </div>
            {e.job_title_ids && <span className="mt-1 block text-xs text-red-700">{e.job_title_ids}</span>}
          </fieldset>
          <Checkbox name="same_department" label="Only from the employee's own department" defaultChecked={values?.same_department} />
        </div>
      )}
    </InlineForm>
  );
}

export function HolidayForm({ action, year }: { action: Action; year: number }) {
  return (
    <InlineForm action={action} openLabel="Add holiday" submitLabel="Add" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" error={e.holiday_date}>
            <Input name="holiday_date" type="date" min={`${year}-01-01`} max={`${year}-12-31`} required />
          </Field>
          <Field label="Name" error={e.name}>
            <Input name="name" placeholder="For example, Eid al-Fitr" required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
