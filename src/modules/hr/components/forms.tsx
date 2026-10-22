"use client";

import { useActionState, useEffect, useRef } from "react";
import { InlineForm } from "@/components/inline-form";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { CONTRACT_TYPES, DOCUMENT_TYPES, EXIT_KINDS, JOB_CHANGES, QUALIFICATION_KINDS, RELATIONSHIPS } from "../constants";
import type { Department, JobTitle } from "../queries";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const today = () => new Date().toISOString().slice(0, 10);

function Options({ choices }: { choices: Record<string, string> }) {
  return Object.entries(choices).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

export function ConfirmForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Confirm appointment" submitLabel="Confirm" variant="primary">
      {(e) => (
        <Field label="Confirmed with effect from" error={e.confirmed_on}>
          <Input name="confirmed_on" type="date" defaultValue={today()} max={today()} required />
        </Field>
      )}
    </InlineForm>
  );
}

export function JobChangeForm({
  action,
  branches,
  departments,
  jobTitles,
  current,
}: {
  action: Action;
  branches: { id: string; name: string }[];
  departments: Department[];
  jobTitles: JobTitle[];
  current: { branch_id: string; department_code: string; job_title_id: string };
}) {
  return (
    <InlineForm action={action} openLabel="Transfer or promote" submitLabel="Save change">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Kind of change" error={e.event}>
            <Select name="event" defaultValue="" required>
              <option value="">Choose</option>
              <Options choices={JOB_CHANGES} />
            </Select>
          </Field>
          <Field label="Effective date" error={e.effective_date}>
            <Input name="effective_date" type="date" defaultValue={today()} required />
          </Field>
          <div />
          <Field label="Branch" error={e.branch_id}>
            <Select name="branch_id" defaultValue={current.branch_id} required>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department" error={e.department_code}>
            <Select name="department_code" defaultValue={current.department_code} required>
              {departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Job title" error={e.job_title_id}>
            <Select name="job_title_id" defaultValue={current.job_title_id} required>
              {jobTitles
                .filter((t) => t.is_active || t.id === current.job_title_id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Field label="Reason" error={e.reason} hint="Kept on the job history">
              <Textarea name="reason" rows={2} required />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function ExitForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Record exit" submitLabel="Record exit" variant="danger">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Left because they" error={e.kind}>
            <Select name="kind" defaultValue="" required>
              <option value="">Choose</option>
              <Options choices={EXIT_KINDS} />
            </Select>
          </Field>
          <Field label="Last working day" error={e.exit_date}>
            <Input name="exit_date" type="date" defaultValue={today()} max={today()} required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason" error={e.reason} hint="Their ERP login is switched off as soon as you save">
              <Textarea name="reason" rows={2} required />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function ReinstateForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Reinstate" submitLabel="Reinstate">
      {(e) => (
        <Field label="Reason" error={e.reason} hint="For example, the resignation was withdrawn. Add a new contract afterwards.">
          <Textarea name="reason" rows={2} required />
        </Field>
      )}
    </InlineForm>
  );
}

export function ContractForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add contract" submitLabel="Add contract" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type" error={e.contract_type}>
            <Select name="contract_type" defaultValue="" required>
              <option value="">Choose</option>
              <Options choices={CONTRACT_TYPES} />
            </Select>
          </Field>
          <Field label="Starts" error={e.start_date}>
            <Input name="start_date" type="date" required />
          </Field>
          <Field label="Ends" error={e.end_date} hint="Leave blank for a permanent contract">
            <Input name="end_date" type="date" />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Notes" error={e.notes} hint="The current contract ends the day before this one starts">
              <Input name="notes" />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function ContractEndForm({ action, contractId, endDate }: { action: Action; contractId: string; endDate: string | null }) {
  return (
    <InlineForm action={action} openLabel="Change end date" submitLabel="Save">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="contract_id" value={contractId} />
          <Field label="New end date" error={e.end_date}>
            <Input name="end_date" type="date" defaultValue={endDate ?? ""} required />
          </Field>
          <Field label="Notes" error={e.notes}>
            <Input name="notes" placeholder="For example, renewed for a year" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function DependentForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add dependent" submitLabel="Add">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" error={e.full_name}>
            <Input name="full_name" required />
          </Field>
          <Field label="Relationship" error={e.relationship}>
            <Select name="relationship" defaultValue="" required>
              <option value="">Choose</option>
              <Options choices={RELATIONSHIPS} />
            </Select>
          </Field>
          <Field label="Date of birth" error={e.date_of_birth}>
            <Input name="date_of_birth" type="date" max={today()} />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function QualificationForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add qualification" submitLabel="Add">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Kind" error={e.kind}>
            <Select name="kind" defaultValue="education" required>
              <Options choices={QUALIFICATION_KINDS} />
            </Select>
          </Field>
          <Field label="Qualification" error={e.qualification}>
            <Input name="qualification" placeholder="B.Sc., HND, ACA…" required />
          </Field>
          <Field label="Year" error={e.year_obtained}>
            <Input name="year_obtained" type="number" min={1950} max={2100} />
          </Field>
          <Field label="Course" error={e.course}>
            <Input name="course" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Institution or awarding body" error={e.institution}>
              <Input name="institution" />
            </Field>
          </div>
          <Field label="Expires" error={e.expires_on} hint="For certifications that must be renewed">
            <Input name="expires_on" type="date" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function DocumentUpload({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={formAction} className="grid items-end gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
      <Field label="Document" error={state.fieldErrors?.document_type}>
        <Select name="document_type" required defaultValue="">
          <option value="">Choose</option>
          <Options choices={DOCUMENT_TYPES} />
        </Select>
      </Field>
      <Field label="File (PDF, JPEG or PNG, up to 10 MB)" error={state.fieldErrors?.file}>
        <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
      <div className="sm:col-span-3">
        <FormError message={state.error} />
      </div>
    </form>
  );
}

export function JobTitleForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add job title" submitLabel="Add" variant="primary">
      {(e) => (
        <Field label="Job title" error={e.name}>
          <Input name="name" required />
        </Field>
      )}
    </InlineForm>
  );
}
