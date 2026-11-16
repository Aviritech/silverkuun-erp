"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { FREQUENCIES, ISSUE_CHANNELS, PAYMENT_METHODS } from "../constants";
import { InlineForm } from "@/components/inline-form";
import { formatMoney } from "@/lib/format";
import type { PlanType } from "../queries";

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

/** The staff member who brought the client in confirms they know them; the file goes back to the officer. */
export function StaffConfirmForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Confirm and send to the officer" submitLabel="Confirm client" variant="primary">
      {(e) => (
        <Field label="Note for the officer (optional)" error={e.note}>
          <Textarea name="note" rows={2} placeholder="For example: I brought this client in; details confirmed by phone." />
        </Field>
      )}
    </InlineForm>
  );
}

/** The officer names the staff member, from any department, who brought the client in. */
export function SendToStaffForm({
  action,
  staff,
  defaultStaffId,
}: {
  action: Action;
  staff: { id: string; full_name: string; department: string }[];
  defaultStaffId?: string | null;
}) {
  return (
    <InlineForm action={action} openLabel="Send to staff" submitLabel="Send to staff" variant="primary">
      {(e) => (
        <Field label="Who brought this client in?" error={e.staff_id} hint="Any staff member. They confirm the client, then the file comes back to you.">
          <Select name="staff_id" required defaultValue={defaultStaffId ?? ""}>
            <option value="">Choose a staff member</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} ({s.department})
              </option>
            ))}
          </Select>
        </Field>
      )}
    </InlineForm>
  );
}

export function ConfirmReceiptForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Matches the member's records" submitLabel="Confirm receipt" variant="primary">
      {(e) => (
        <Field label="Note for Accounts (optional)" error={e.note}>
          <Textarea name="note" rows={2} placeholder="For example: matches the passbook and the member's payment card." />
        </Field>
      )}
    </InlineForm>
  );
}

export function PlanForm({ action, planTypes }: { action: Action; planTypes: PlanType[] }) {
  const [code, setCode] = useState("");
  const type = planTypes.find((p) => p.code === code);
  const tenures = type?.tenure_months ?? null;
  return (
    <InlineForm action={action} openLabel="Add plan" submitLabel="Add plan" variant="primary">
      {(e) => (
        <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Plan" error={e.plan_type}>
              <Select name="plan_type" required value={code} onChange={(ev) => setCode(ev.target.value)}>
                <option value="">Choose</option>
                {planTypes.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount (₦)" error={e.contribution_amount}>
              <Input
                name="contribution_amount"
                type="number"
                min={type?.min_amount ?? "0.01"}
                step="0.01"
                required
              />
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
            {tenures ? (
              <Field label="Tenure" error={e.tenure_months}>
                <Select key={code} name="tenure_months" required defaultValue={tenures.length === 1 ? String(tenures[0]) : ""}>
                  {tenures.length > 1 && <option value="">Choose</option>}
                  {tenures.map((m) => (
                    <option key={m} value={m}>
                      {m} months
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Maturity date" error={e.maturity_date}>
                <Input name="maturity_date" type="date" required />
              </Field>
            )}
            {!type?.dividends_at_maturity && (
              <Field label="Interest pay day" error={e.interest_pay_day} hint="Day of the month, 1 to 31">
                <Input name="interest_pay_day" type="number" min={1} max={31} step={1} required />
              </Field>
            )}
          </div>
          {type && (
            <p className="text-xs text-zinc-500">
              {[
                type.description,
                tenures && `Runs for ${tenures.join(", ")} months; matures that long after the start date.`,
                type.min_amount && !type.description.includes("naira") && `Minimum ${formatMoney(type.min_amount)}.`,
                type.max_amount && !type.description.includes("naira") && `Maximum ${formatMoney(type.max_amount)}.`,
                type.dividends_at_maturity && "No monthly interest, so no pay day: the savings and all dividends are paid together at maturity.",
                !type.dividends_at_maturity && "Interest is paid on the pay day each month; a day past the end of a shorter month pays on its last day.",
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          )}
        </div>
      )}
    </InlineForm>
  );
}

/** Changes the day an active plan's monthly interest is paid. For holders of members.amend; needs a reason. */
export function PayDayForm({ action, current }: { action: Action; current: number | null }) {
  return (
    <InlineForm action={action} openLabel={current ? "Change pay day" : "Set pay day"} submitLabel="Save pay day">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Interest pay day" error={e.interest_pay_day} hint="Day of the month, 1 to 31">
            <Input name="interest_pay_day" type="number" min={1} max={31} step={1} defaultValue={current ?? ""} required />
          </Field>
          <Field label="Reason for the change" error={e.reason}>
            <Input name="reason" placeholder="For example: the member is now paid at the end of the month" required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

/** A scheduled contribution. Top-ups aren't recorded here: they come from Accounts (see the Top ups from Accounts queue). */
export function ContributionForm({ action, planId }: { action: Action; planId: string }) {
  const label = "Record contribution";
  return (
    <InlineForm action={action} openLabel={label} submitLabel={label} variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="member_plan_id" value={planId} />
          <input type="hidden" name="kind" value="scheduled" />
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
