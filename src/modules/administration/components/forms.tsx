"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { FREQUENCIES, ISSUE_CHANNELS, PAYMENT_METHODS } from "../constants";
import { InlineForm } from "@/components/inline-form";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const today = () => new Date().toISOString().slice(0, 10);

export function ReturnForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Return for correction" submitLabel="Return file" variant="danger">
      {(e) => (
        <Field label="What needs correcting?" error={e.reason}>
          <Textarea name="reason" rows={3} required />
        </Field>
      )}
    </InlineForm>
  );
}

export function MarketerReviewForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Confirm and send back to the officer" submitLabel="Confirm member" variant="primary">
      {(e) => (
        <Field label="Note for the officer (optional)" error={e.note}>
          <Textarea name="note" rows={2} placeholder="For example: I brought this member in; details confirmed by phone." />
        </Field>
      )}
    </InlineForm>
  );
}

export function PlanForm({ action, planTypes }: { action: Action; planTypes: { code: string; name: string }[] }) {
  return (
    <InlineForm action={action} openLabel="Add plan" submitLabel="Add plan" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Plan" error={e.plan_type}>
            <Select name="plan_type" required defaultValue="">
              <option value="">Choose</option>
              {planTypes.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (₦)" error={e.contribution_amount}>
            <Input name="contribution_amount" type="number" min="0.01" step="0.01" required />
          </Field>
          <Field label="How often" error={e.contribution_frequency}>
            <Select name="contribution_frequency" required defaultValue="monthly">
              {Object.entries(FREQUENCIES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" error={e.start_date}>
            <Input name="start_date" type="date" defaultValue={today()} required />
          </Field>
          <Field label="Maturity date" error={e.maturity_date}>
            <Input name="maturity_date" type="date" required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function ContributionForm({
  action,
  planId,
  kind,
}: {
  action: Action;
  planId: string;
  kind: "scheduled" | "top_up";
}) {
  const label = kind === "top_up" ? "Record top-up" : "Record contribution";
  return (
    <InlineForm action={action} openLabel={label} submitLabel={label} variant={kind === "top_up" ? "secondary" : "primary"}>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="member_plan_id" value={planId} />
          <input type="hidden" name="kind" value={kind} />
          <Field label="Amount (₦)" error={e.amount}>
            <Input name="amount" type="number" min="0.01" step="0.01" required />
          </Field>
          <Field label="Date paid" error={e.paid_on}>
            <Input name="paid_on" type="date" max={today()} defaultValue={today()} required />
          </Field>
          <Field label="Paid by" error={e.payment_method}>
            <Select name="payment_method" required defaultValue="bank_transfer">
              {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transaction reference" error={e.reference}>
            <Input name="reference" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function ReversalForm({ action, contributionId }: { action: Action; contributionId: string }) {
  return (
    <InlineForm action={action} openLabel="Reverse" submitLabel="Record reversal" variant="danger">
      {(e) => (
        <>
          <input type="hidden" name="contribution_id" value={contributionId} />
          <Field label="Why is this entry being reversed?" error={e.notes}>
            <Textarea name="notes" rows={2} required />
          </Field>
        </>
      )}
    </InlineForm>
  );
}

export function IssueForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Record issue" submitLabel="Record issue">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date issued" error={e.issued_on}>
            <Input name="issued_on" type="date" max={today()} defaultValue={today()} required />
          </Field>
          <Field label="How it was sent" error={e.issue_channel}>
            <Select name="issue_channel" required defaultValue="in_person">
              {Object.entries(ISSUE_CHANNELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note (optional)" error={e.issue_note}>
            <Input name="issue_note" placeholder="Received by, email address…" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function TargetForm({
  action,
  branches,
  month,
}: {
  action: Action;
  branches: { id: string; name: string }[];
  month: string;
}) {
  return (
    <InlineForm action={action} openLabel="Set a target" submitLabel="Save target" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Branch" error={e.branch_id}>
            <Select name="branch_id" required defaultValue="">
              <option value="">Choose</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Month" error={e.month}>
            <Input name="month" type="month" defaultValue={month} required />
          </Field>
          <Field label="New members" error={e.registrations}>
            <Input name="registrations" type="number" min="0" step="1" required />
          </Field>
          <Field label="Collections (₦)" error={e.collections}>
            <Input name="collections" type="number" min="0" step="0.01" required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
