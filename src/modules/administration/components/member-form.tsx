"use client";

import { useState, type ReactNode } from "react";
import { useFormAction } from "@/lib/use-form-action";
import {
  Button,
  Field,
  FormError,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { ID_TYPES, NIGERIAN_STATES } from "../constants";
import type { Branch, CbnBank, Member } from "../queries";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  branches?: Branch[];
  banks: CbnBank[];
  member?: Partial<Member>;
  requireReason?: boolean;
  submitLabel: string;
  /** Shown while saving, instead of "Saving…". */
  pendingLabel?: string;
  /** Extra fields placed just above the submit button, such as the client's document uploads. */
  children?: ReactNode | ((errors: Record<string, string>) => ReactNode);
};

export function MemberForm({
  action,
  branches,
  banks,
  member = {},
  requireReason,
  submitLabel,
  pendingLabel = "Saving…",
  children,
}: Props) {
  const [state, formAction, pending] = useFormAction(action, {});
  // "other" is a bank without a CBN code, entered by name.
  const [bankChoice, setBankChoice] = useState(
    member.bank_code ?? (member.bank_name ? "other" : ""),
  );
  const e = state.fieldErrors ?? {};

  return (
    <form onSubmit={formAction} className="space-y-6">
      <FormError message={state.error} />

      {branches && (
        <Field label="Branch" error={e.branch_id}>
          <Select
            name="branch_id"
            defaultValue={
              member.branch_id ?? (branches.length === 1 ? branches[0].id : "")
            }
            required
          >
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
        <legend className="mb-2 text-sm font-semibold text-zinc-700">
          Personal details
        </legend>
        <Field label="Title" error={e.title}>
          <Input
            name="title"
            defaultValue={member.title ?? ""}
            placeholder="Mr, Mrs, Dr…"
          />
        </Field>
        <Field label="First name" error={e.first_name}>
          <Input
            name="first_name"
            defaultValue={member.first_name ?? ""}
            required
          />
        </Field>
        <Field label="Middle name" error={e.middle_name}>
          <Input name="middle_name" defaultValue={member.middle_name ?? ""} />
        </Field>
        <Field label="Last name" error={e.last_name}>
          <Input
            name="last_name"
            defaultValue={member.last_name ?? ""}
            required
          />
        </Field>
        <Field label="Date of birth" error={e.date_of_birth}>
          <Input
            name="date_of_birth"
            type="date"
            defaultValue={member.date_of_birth ?? ""}
          />
        </Field>
        <Field label="Gender" error={e.gender}>
          <Select name="gender" defaultValue={member.gender ?? ""}>
            <option value="">Not given</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </Field>
        <Field label="Phone" error={e.phone}>
          <Input
            name="phone"
            type="tel"
            defaultValue={member.phone ?? ""}
            required
          />
        </Field>
        <Field label="Email" error={e.email}>
          <Input name="email" type="email" defaultValue={member.email ?? ""} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">
          Residential address
        </legend>
        <div className="sm:col-span-4">
          <Field label="House number and street" error={e.address}>
            <Textarea
              name="address"
              rows={2}
              defaultValue={member.address ?? ""}
              placeholder="12 Allen Avenue"
              required
            />
          </Field>
        </div>
        <Field label="Town or city" error={e.address_city}>
          <Input
            name="address_city"
            maxLength={100}
            defaultValue={member.address_city ?? ""}
            placeholder="Ikeja"
          />
        </Field>
        <Field label="LGA" error={e.address_lga} hint="Local Government Area">
          <Input
            name="address_lga"
            maxLength={100}
            defaultValue={member.address_lga ?? ""}
            required
          />
        </Field>
        <Field label="State" error={e.address_state}>
          <Select
            name="address_state"
            defaultValue={member.address_state ?? ""}
            required
          >
            <option value="">Choose a state</option>
            {NIGERIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Nearest landmark"
          error={e.address_landmark}
          hint="Such as “opposite First Bank”"
        >
          <Input
            name="address_landmark"
            maxLength={200}
            defaultValue={member.address_landmark ?? ""}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">
          Identification
        </legend>
        <Field label="NIN" error={e.nin} hint="11 digits">
          <Input
            name="nin"
            inputMode="numeric"
            maxLength={11}
            defaultValue={member.nin ?? ""}
            required
          />
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
          <Input
            name="id_number"
            defaultValue={member.id_number ?? ""}
            required
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">
          Next of kin
        </legend>
        <Field label="Name" error={e.next_of_kin_name}>
          <Input
            name="next_of_kin_name"
            defaultValue={member.next_of_kin_name ?? ""}
          />
        </Field>
        <Field label="Phone" error={e.next_of_kin_phone}>
          <Input
            name="next_of_kin_phone"
            type="tel"
            defaultValue={member.next_of_kin_phone ?? ""}
          />
        </Field>
        <Field label="Relationship" error={e.next_of_kin_relationship}>
          <Input
            name="next_of_kin_relationship"
            defaultValue={member.next_of_kin_relationship ?? ""}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">
          Bank account for interest payments
        </legend>
        <Field label="Bank" error={e.bank_code}>
          <Select
            value={bankChoice}
            onChange={(ev) => setBankChoice(ev.target.value)}
          >
            <option value="">Not given yet</option>
            {banks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name} ({b.code})
              </option>
            ))}
            <option value="other">Another bank (no CBN code)</option>
          </Select>
          <input
            type="hidden"
            name="bank_code"
            value={bankChoice === "other" ? "" : bankChoice}
          />
        </Field>
        {bankChoice === "other" && (
          <Field label="Bank name" error={e.bank_name}>
            <Input
              name="bank_name"
              defaultValue={member.bank_code ? "" : (member.bank_name ?? "")}
              required
            />
          </Field>
        )}
        <Field
          label="Account number"
          error={e.bank_account_no}
          hint="10 digits"
        >
          <Input
            name="bank_account_no"
            inputMode="numeric"
            maxLength={10}
            defaultValue={member.bank_account_no ?? ""}
            required={Boolean(bankChoice)}
          />
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

      {typeof children === "function" ? children(e) : children}

      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
