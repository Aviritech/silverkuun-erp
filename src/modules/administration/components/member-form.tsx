"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { ID_TYPES } from "../constants";
import type { Branch, Member } from "../queries";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  branches?: Branch[];
  member?: Partial<Member>;
  requireReason?: boolean;
  submitLabel: string;
};

export function MemberForm({ action, branches, member = {}, requireReason, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <FormError message={state.error} />

      {branches && (
        <Field label="Branch" error={e.branch_id}>
          <Select name="branch_id" defaultValue={member.branch_id ?? (branches.length === 1 ? branches[0].id : "")} required>
            <option value="">Choose a branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Personal details</legend>
        <Field label="Title" error={e.title}>
          <Input name="title" defaultValue={member.title ?? ""} placeholder="Mr, Mrs, Dr…" />
        </Field>
        <Field label="First name" error={e.first_name}>
          <Input name="first_name" defaultValue={member.first_name ?? ""} required />
        </Field>
        <Field label="Middle name" error={e.middle_name}>
          <Input name="middle_name" defaultValue={member.middle_name ?? ""} />
        </Field>
        <Field label="Last name" error={e.last_name}>
          <Input name="last_name" defaultValue={member.last_name ?? ""} required />
        </Field>
        <Field label="Date of birth" error={e.date_of_birth}>
          <Input name="date_of_birth" type="date" defaultValue={member.date_of_birth ?? ""} />
        </Field>
        <Field label="Gender" error={e.gender}>
          <Select name="gender" defaultValue={member.gender ?? ""}>
            <option value="">Not given</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </Field>
        <Field label="Phone" error={e.phone}>
          <Input name="phone" type="tel" defaultValue={member.phone ?? ""} required />
        </Field>
        <Field label="Email" error={e.email}>
          <Input name="email" type="email" defaultValue={member.email ?? ""} />
        </Field>
        <div className="sm:col-span-4">
          <Field label="Residential address" error={e.address}>
            <Textarea name="address" rows={2} defaultValue={member.address ?? ""} required />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Identification</legend>
        <Field label="NIN" error={e.nin} hint="11 digits">
          <Input name="nin" inputMode="numeric" maxLength={11} defaultValue={member.nin ?? ""} required />
        </Field>
        <Field label="Means of ID" error={e.id_type}>
          <Select name="id_type" defaultValue={member.id_type ?? ""} required>
            <option value="">Choose</option>
            {Object.entries(ID_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ID number" error={e.id_number}>
          <Input name="id_number" defaultValue={member.id_number ?? ""} required />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Next of kin</legend>
        <Field label="Name" error={e.next_of_kin_name}>
          <Input name="next_of_kin_name" defaultValue={member.next_of_kin_name ?? ""} />
        </Field>
        <Field label="Phone" error={e.next_of_kin_phone}>
          <Input name="next_of_kin_phone" type="tel" defaultValue={member.next_of_kin_phone ?? ""} />
        </Field>
        <Field label="Relationship" error={e.next_of_kin_relationship}>
          <Input name="next_of_kin_relationship" defaultValue={member.next_of_kin_relationship ?? ""} />
        </Field>
      </fieldset>

      {requireReason && (
        <Field
          label="Reason for this change"
          error={e.amendment_reason}
          hint="This member is already approved, so the reason is kept in the audit trail."
        >
          <Textarea name="amendment_reason" rows={2} required />
        </Field>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
