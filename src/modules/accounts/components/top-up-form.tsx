"use client";

import { useCallback, useState } from "react";
import { InlineForm } from "@/components/inline-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { PAYMENT_METHODS } from "@/modules/administration/constants";
import type { TopUpMemberHit } from "@/modules/accounts/top-ups";
import { TopUpMemberSearch } from "./top-up-member-search";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Branch = { id: string; name: string };
type Bank = { id: string; name: string; branch_id: string; kind: string };

export type TopUpDefaults = {
  branch_id: string;
  amount: string;
  paid_on: string;
  payment_method: string;
  reference: string | null;
  bank_account_id: string | null;
  paid_by: string;
  note: string | null;
  branch_name?: string;
  matched_member_id?: string | null;
  matched_member_name?: string | null;
  matched_membership_no?: string | null;
  matched_plan_id?: string | null;
  matched_plan_name?: string | null;
};

/** What the form knows about the member matched last time, enough to show it again when resending. */
function defaultMatch(d?: TopUpDefaults): TopUpMemberHit | null {
  if (!d?.matched_member_id) return null;
  return {
    member_id: d.matched_member_id,
    member_name: d.matched_member_name ?? d.paid_by,
    membership_no: d.matched_membership_no ?? null,
    phone_hint: "",
    branch_id: d.branch_id,
    branch_name: d.branch_name ?? "",
    plans: d.matched_plan_id
      ? [{ id: d.matched_plan_id, plan_name: d.matched_plan_name ?? "Plan", start_date: "", maturity_date: "", contribution_amount: 0, contribution_frequency: "" }]
      : [],
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** Accounts records money received for a member and chooses the branch whose officer logs it. */
export function TopUpForm({
  action,
  branches,
  banks,
  defaults,
  openLabel = "New top up",
  submitLabel = "Send to branch",
  variant = "primary",
  searchMembers,
}: {
  action: Action;
  branches: Branch[];
  banks: Bank[];
  defaults?: TopUpDefaults;
  openLabel?: string;
  submitLabel?: string;
  variant?: "primary" | "secondary";
  searchMembers?: (query: string) => Promise<TopUpMemberHit[]>;
}) {
  const [branchId, setBranchId] = useState(defaults?.branch_id ?? (branches.length === 1 ? branches[0].id : ""));
  const choices = banks.filter((b) => b.branch_id === branchId);
  // Picking a member sends the top up to the member's own branch.
  const onMatch = useCallback(
    (hit: TopUpMemberHit | null) => {
      if (hit && branches.some((b) => b.id === hit.branch_id)) setBranchId(hit.branch_id);
    },
    [branches],
  );
  return (
    <InlineForm action={action} openLabel={openLabel} submitLabel={submitLabel} variant={variant}>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <TopUpMemberSearch
              defaultPaidBy={defaults?.paid_by}
              defaultMatch={defaultMatch(defaults)}
              defaultPlanId={defaults?.matched_plan_id}
              branchId={branchId}
              error={e.paid_by ?? e.member_id ?? e.member_plan_id}
              onMatch={onMatch}
              search={searchMembers}
            />
          </div>
          <Field label="Branch it goes to" error={e.branch_id}>
            <Select name="branch_id" required value={branchId} onChange={(ev) => setBranchId(ev.target.value)}>
              <option value="">Choose a branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (₦)" error={e.amount}>
            <Input name="amount" type="number" min="0.01" step="0.01" required defaultValue={defaults?.amount} />
          </Field>
          <Field label="Date paid" error={e.paid_on}>
            <Input name="paid_on" type="date" max={today()} defaultValue={defaults?.paid_on ?? today()} required />
          </Field>
          <Field label="How it was paid" error={e.payment_method}>
            <Select name="payment_method" required defaultValue={defaults?.payment_method ?? "bank_transfer"}>
              {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transaction reference" error={e.reference}>
            <Input name="reference" defaultValue={defaults?.reference ?? ""} />
          </Field>
          <Field label="Paid into (optional)" error={e.bank_account_id}>
            <Select name="bank_account_id" key={branchId} defaultValue={choices.some((b) => b.id === defaults?.bank_account_id) ? defaults!.bank_account_id! : ""}>
              <option value="">{branchId ? "Not sure yet" : "Choose the branch first"}</option>
              {choices.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note for the branch (optional)" error={e.note}>
            <Textarea name="note" rows={1} defaultValue={defaults?.note ?? ""} placeholder="e.g. Member says it's for the Gold plan" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
