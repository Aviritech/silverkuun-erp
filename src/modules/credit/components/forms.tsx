"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { InlineForm } from "@/components/inline-form";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import {
  BUREAU_RESULTS,
  COLLATERAL_TYPES,
  INTEREST_METHODS,
  LOAN_DOCUMENT_TYPES,
  RATE_BASES,
  REMINDER_CHANNELS,
  REPAYMENT_FREQUENCIES,
  RISK_RATINGS,
  type LoanDocumentType,
} from "../constants";
import type { LoanProduct } from "../queries";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const today = () => new Date().toISOString().slice(0, 10);

function Options({ values }: { values: Record<string, string | { label: string }> }) {
  return (
    <>
      {Object.entries(values).map(([v, l]) => (
        <option key={v} value={v}>
          {typeof l === "string" ? l : l.label}
        </option>
      ))}
    </>
  );
}

export function GuarantorForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add guarantor" submitLabel="Add guarantor">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Full name" error={e.full_name}>
            <Input name="full_name" required />
          </Field>
          <Field label="Phone" error={e.phone}>
            <Input name="phone" required />
          </Field>
          <Field label="Relationship to the customer" error={e.relationship}>
            <Input name="relationship" placeholder="Brother, employer, colleague…" />
          </Field>
          <Field label="Address" error={e.address}>
            <Input name="address" required />
          </Field>
          <Field label="Occupation" error={e.occupation}>
            <Input name="occupation" />
          </Field>
          <Field label="Employer" error={e.employer}>
            <Input name="employer" />
          </Field>
          <Field label="Monthly income (₦)" error={e.monthly_income}>
            <Input name="monthly_income" type="number" min="0" step="0.01" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="is_member" className="h-4 w-4 rounded border-zinc-300" /> Also a Silverkuun member
          </label>
        </div>
      )}
    </InlineForm>
  );
}

export function CollateralForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add collateral" submitLabel="Add collateral">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type" error={e.collateral_type}>
            <Select name="collateral_type" required defaultValue="">
              <option value="">Choose</option>
              <Options values={COLLATERAL_TYPES} />
            </Select>
          </Field>
          <Field label="Estimated value (₦)" error={e.estimated_value}>
            <Input name="estimated_value" type="number" min="0.01" step="0.01" required />
          </Field>
          <Field label="Valued on" error={e.valuation_date}>
            <Input name="valuation_date" type="date" max={today()} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" error={e.description}>
              <Input name="description" placeholder="Toyota Corolla 2015, LAG-123-XY; C of O no. …" required />
            </Field>
          </div>
          <Field label="Valued by" error={e.valued_by}>
            <Input name="valued_by" placeholder="Valuer or officer" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function LoanDocumentUpload({ action, types }: { action: Action; types: LoanDocumentType[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={formAction} className="grid items-end gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
      <Field label="Document" error={state.fieldErrors?.document_type}>
        <Select name="document_type" required defaultValue={types.length === 1 ? types[0] : ""}>
          <option value="">Choose</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {LOAN_DOCUMENT_TYPES[t]}
            </option>
          ))}
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

export function AppraisalForm({ action, amountRequested }: { action: Action; amountRequested: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [recommendation, setRecommendation] = useState("approve");
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Credit bureau result" error={e.bureau_check}>
          <Select name="bureau_check" required defaultValue="">
            <option value="">Choose</option>
            <Options values={BUREAU_RESULTS} />
          </Select>
        </Field>
        <Field label="Bureau" error={e.bureau_name}>
          <Input name="bureau_name" placeholder="CRC, FirstCentral, CreditRegistry" />
        </Field>
        <Field label="Score or reference" error={e.bureau_score}>
          <Input name="bureau_score" />
        </Field>
        <Field label="Risk rating" error={e.risk_rating}>
          <Select name="risk_rating" required defaultValue="">
            <option value="">Choose</option>
            <Options values={RISK_RATINGS} />
          </Select>
        </Field>
        <Field label="Recommendation" error={e.recommendation}>
          <Select name="recommendation" value={recommendation} onChange={(ev) => setRecommendation(ev.target.value)}>
            <option value="approve">Approve</option>
            <option value="decline">Decline</option>
          </Select>
        </Field>
        {recommendation === "approve" && (
          <Field label="Recommended amount (₦)" error={e.recommended_amount}>
            <Input name="recommended_amount" type="number" min="0.01" max={amountRequested} step="0.01" defaultValue={amountRequested} required />
          </Field>
        )}
      </div>
      <Field label="Appraisal" error={e.notes} hint="Capacity to repay, character, the business or employment, and the security offered.">
        <Textarea name="notes" rows={4} required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Send to management"}
      </Button>
    </form>
  );
}

export function DecisionForm({ action, recommendedAmount }: { action: Action; recommendedAmount: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [decision, setDecision] = useState("approve");
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Decision" error={e.decision}>
          <Select name="decision" value={decision} onChange={(ev) => setDecision(ev.target.value)}>
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
          </Select>
        </Field>
        {decision === "approve" && (
          <Field label="Amount approved (₦)" error={e.approved_amount}>
            <Input name="approved_amount" type="number" min="0.01" step="0.01" defaultValue={recommendedAmount} required />
          </Field>
        )}
      </div>
      <Field label={decision === "approve" ? "Conditions or note (optional)" : "Reason for rejecting"} error={e.note}>
        <Textarea name="note" rows={2} required={decision === "reject"} />
      </Field>
      <Button type="submit" variant={decision === "approve" ? "primary" : "danger"} disabled={pending}>
        {pending ? "Saving…" : decision === "approve" ? "Approve loan" : "Reject application"}
      </Button>
    </form>
  );
}

export function ReassignForm({ action, officers, current }: { action: Action; officers: { id: string; full_name: string }[]; current: string }) {
  return (
    <InlineForm action={action} openLabel="Change account officer" submitLabel="Reassign">
      {(e) => (
        <Field label="New account officer" error={e.account_officer_id}>
          <Select name="account_officer_id" required defaultValue={current}>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </InlineForm>
  );
}

export function RestructureForm({ action, defaults }: { action: Action; defaults: { rate: string; basis: string; method: string; frequency: string } }) {
  return (
    <InlineForm action={action} openLabel="Request restructure" submitLabel="Send for approval">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="New duration (months)" error={e.tenor_months}>
            <Input name="tenor_months" type="number" min="1" max="120" required />
          </Field>
          <Field label="Repayment frequency" error={e.repayment_frequency}>
            <Select name="repayment_frequency" defaultValue={defaults.frequency}>
              <Options values={REPAYMENT_FREQUENCIES} />
            </Select>
          </Field>
          <Field label="First new repayment date" error={e.first_repayment_date}>
            <Input name="first_repayment_date" type="date" min={today()} required />
          </Field>
          <Field label="Interest rate" error={e.interest_rate}>
            <div className="flex gap-2">
              <Input name="interest_rate" type="number" min="0" max="100" step="0.0001" defaultValue={defaults.rate} required />
              <Select name="rate_basis" defaultValue={defaults.basis} aria-label="Rate basis">
                <Options values={RATE_BASES} />
              </Select>
            </div>
          </Field>
          <Field label="Interest method" error={e.interest_method}>
            <Select name="interest_method" defaultValue={defaults.method}>
              <Options values={INTEREST_METHODS} />
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Field
              label="Why is the loan being restructured?"
              error={e.reason}
              hint="The principal still owed, plus interest already due and unpaid, is rescheduled on these terms once management approves."
            >
              <Textarea name="reason" rows={2} required />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function RestructureDecisionForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [decision, setDecision] = useState("approve");
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <Select name="decision" value={decision} onChange={(ev) => setDecision(ev.target.value)} aria-label="Decision">
          <option value="approve">Approve</option>
          <option value="reject">Decline</option>
        </Select>
      </div>
      <div className="min-w-56 flex-1">
        <Input name="note" placeholder={decision === "approve" ? "Note (optional)" : "Reason for declining"} aria-label="Note" />
      </div>
      <Button type="submit" variant={decision === "approve" ? "primary" : "danger"} disabled={pending} className="mt-1">
        {pending ? "Saving…" : decision === "approve" ? "Approve restructure" : "Decline"}
      </Button>
      {(state.error || state.fieldErrors?.note) && <span className="w-full text-xs text-red-700">{state.error ?? state.fieldErrors?.note}</span>}
    </form>
  );
}

export function ReminderForm({
  action,
  kind,
  dueDate,
  amount,
  message,
}: {
  action: Action;
  kind: "upcoming" | "overdue";
  dueDate?: string | null;
  amount?: string | null;
  message: string;
}) {
  return (
    <InlineForm action={action} openLabel="Record reminder" submitLabel="Save">
      {(e) => (
        <div className="space-y-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="due_date" value={dueDate ?? ""} />
          <input type="hidden" name="amount" value={amount ?? ""} />
          <div className="rounded-md bg-white px-3 py-2 text-xs text-zinc-600 ring-1 ring-zinc-200">
            <span className="font-medium text-zinc-800">Suggested message: </span>
            {message}
          </div>
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <Field label="How you reached them" error={e.channel}>
              <Select name="channel" required defaultValue="sms">
                <Options values={REMINDER_CHANNELS} />
              </Select>
            </Field>
            <Field label="Outcome (optional)" error={e.note}>
              <Input name="note" placeholder="Promised to pay on Friday" />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function ProductForm({ action, product }: { action: Action; product?: LoanProduct }) {
  return (
    <InlineForm action={action} openLabel={product ? "Edit" : "Add loan product"} submitLabel="Save product" variant={product ? "secondary" : "primary"}>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-4">
          {!product && (
            <Field label="Code" error={e.code} hint="Can't be changed later.">
              <Input name="code" placeholder="school_fees" required />
            </Field>
          )}
          <Field label="Name" error={e.name}>
            <Input name="name" defaultValue={product?.name} required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" error={e.description}>
              <Input name="description" defaultValue={product?.description} />
            </Field>
          </div>
          <Field label="Interest rate" error={e.interest_rate}>
            <div className="flex gap-2">
              <Input name="interest_rate" type="number" min="0" max="100" step="0.0001" defaultValue={product?.interest_rate} required />
              <Select name="rate_basis" defaultValue={product?.rate_basis ?? "per_month"} aria-label="Rate basis">
                <Options values={RATE_BASES} />
              </Select>
            </div>
          </Field>
          <Field label="Interest method" error={e.interest_method}>
            <Select name="interest_method" defaultValue={product?.interest_method ?? "flat"}>
              <Options values={INTEREST_METHODS} />
            </Select>
          </Field>
          <Field label="Minimum (₦)" error={e.min_amount}>
            <Input name="min_amount" type="number" min="0" step="0.01" defaultValue={product?.min_amount ?? "0"} required />
          </Field>
          <Field label="Maximum (₦)" error={e.max_amount}>
            <Input name="max_amount" type="number" min="0" step="0.01" defaultValue={product?.max_amount ?? ""} placeholder="No limit" />
          </Field>
          <Field label="Longest duration (months)" error={e.max_tenor_months}>
            <Input name="max_tenor_months" type="number" min="1" max="120" defaultValue={product?.max_tenor_months ?? 12} required />
          </Field>
          <div className="flex flex-wrap items-end gap-4 pb-2 text-sm sm:col-span-3">
            {(
              [
                ["requires_guarantor", "Needs a guarantor", product?.requires_guarantor ?? true],
                ["requires_collateral", "Needs collateral", product?.requires_collateral ?? false],
                ["requires_proforma", "Needs a proforma invoice", product?.requires_proforma ?? false],
                ["is_active", "Open for new applications", product?.is_active ?? true],
              ] as const
            ).map(([name, label, checked]) => (
              <label key={name} className="flex items-center gap-2">
                <input type="checkbox" name={name} defaultChecked={checked} className="h-4 w-4 rounded border-zinc-300" /> {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </InlineForm>
  );
}
