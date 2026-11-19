"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";
import { FREQUENCIES } from "../constants";
import type { CbnBank, PlanType } from "../queries";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type LiquidationDefaults = {
  amount: string;
  beneficiary_account_name: string;
  bank_code: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  note?: string | null;
  /** A part payout's new plan, when correcting a request that had one. */
  new_plan_type?: string | null;
  new_contribution_amount?: string | null;
  new_contribution_frequency?: string | null;
  new_tenure_months?: number | null;
  new_interest_pay_day?: number | null;
};

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Operations raises (or corrects) a request to pay out a member's savings, with the account to pay into. Paying out
 * less than the savings still liquidates the whole plan: the rest goes into a new plan, whose instructions are taken
 * here.
 */
export function LiquidationForm({
  action,
  banks,
  planTypes,
  defaults,
  savings,
  openLabel = "Request liquidation",
  submitLabel = "Send to the Branch Manager",
}: {
  action: Action;
  banks: CbnBank[];
  planTypes: PlanType[];
  defaults: LiquidationDefaults;
  /** The plan's verified savings, shown so the officer can check the amount. */
  savings: string;
  openLabel?: string;
  submitLabel?: string;
}) {
  const [bankChoice, setBankChoice] = useState(defaults.bank_code ?? (defaults.bank_name ? "other" : ""));
  const [amount, setAmount] = useState(defaults.amount);
  const [newType, setNewType] = useState(defaults.new_plan_type ?? "");
  const saved = Number(savings) || 0;
  const paying = Number(amount);
  const rest = Math.round((saved - (Number.isFinite(paying) ? paying : 0)) * 100) / 100;
  const isPartial = amount !== "" && Number.isFinite(paying) && paying > 0 && rest > 0;
  const type = planTypes.find((p) => p.code === newType);
  const tenures = type?.tenure_months ?? null;
  return (
    <InlineForm action={action} openLabel={openLabel} submitLabel={submitLabel} variant="secondary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Amount to pay (₦)"
            error={e.amount}
            hint={`Verified savings in this plan: ₦${Number(savings).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`}
          >
            <Input name="amount" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} required />
          </Field>
          <Field label="Beneficiary account name" error={e.beneficiary_account_name}>
            <Input name="beneficiary_account_name" defaultValue={defaults.beneficiary_account_name} required />
          </Field>
          <Field label="Bank" error={e.bank_code}>
            <Select value={bankChoice} onChange={(ev) => setBankChoice(ev.target.value)} required>
              <option value="">Choose</option>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} ({b.code})
                </option>
              ))}
              <option value="other">Another bank (no CBN code)</option>
            </Select>
            <input type="hidden" name="bank_code" value={bankChoice === "other" ? "" : bankChoice} />
          </Field>
          {bankChoice === "other" && (
            <Field label="Bank name" error={e.bank_name}>
              <Input name="bank_name" defaultValue={defaults.bank_code ? "" : (defaults.bank_name ?? "")} required />
            </Field>
          )}
          <Field label="Account number" error={e.bank_account_no}>
            <Input
              name="bank_account_no"
              inputMode="numeric"
              pattern="[0-9]{10}"
              maxLength={10}
              defaultValue={defaults.bank_account_no ?? ""}
              required
            />
          </Field>
          {isPartial && (
            <fieldset className="space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 sm:col-span-2">
              <legend className="px-1 text-sm font-medium">New plan for the rest ({naira(rest)})</legend>
              <p className="text-xs text-zinc-600">
                Paying part of the savings liquidates the whole plan. When Accounts&apos; payment posts, this plan closes and the
                rest moves into a new plan that starts that day, on these instructions.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Plan" error={e.new_plan_type}>
                  <Select name="new_plan_type" required value={newType} onChange={(ev) => setNewType(ev.target.value)}>
                    <option value="">Choose</option>
                    {planTypes.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name} ({Number(p.interest_rate) / 12}% a month)
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Plan amount (₦)" error={e.new_contribution_amount} hint="Starts with the rest of the savings">
                  <Input
                    key={defaults.new_contribution_amount ? undefined : rest}
                    name="new_contribution_amount"
                    inputMode="decimal"
                    defaultValue={defaults.new_contribution_amount ?? String(rest)}
                    required
                  />
                </Field>
                <Field label="How often" error={e.new_contribution_frequency}>
                  <Select name="new_contribution_frequency" required defaultValue={defaults.new_contribution_frequency ?? "one_off"}>
                    {Object.entries(FREQUENCIES).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tenure" error={e.new_tenure_months}>
                  {tenures ? (
                    <Select
                      key={newType}
                      name="new_tenure_months"
                      required
                      defaultValue={
                        defaults.new_tenure_months && tenures.includes(defaults.new_tenure_months)
                          ? String(defaults.new_tenure_months)
                          : tenures.length === 1
                            ? String(tenures[0])
                            : ""
                      }
                    >
                      {tenures.length > 1 && <option value="">Choose</option>}
                      {tenures.map((m) => (
                        <option key={m} value={m}>
                          {m} months
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      key={newType}
                      name="new_tenure_months"
                      type="number"
                      min={1}
                      max={120}
                      step={1}
                      placeholder="Months"
                      defaultValue={defaults.new_tenure_months ?? ""}
                      required
                    />
                  )}
                </Field>
                {!type?.dividends_at_maturity && (
                  <Field label="Interest pay day" error={e.new_interest_pay_day} hint="Day of the month, 1 to 31">
                    <Input
                      name="new_interest_pay_day"
                      type="number"
                      min={1}
                      max={31}
                      step={1}
                      defaultValue={defaults.new_interest_pay_day ?? ""}
                      required
                    />
                  </Field>
                )}
              </div>
              {type && (
                <p className="text-xs text-zinc-500">
                  {[
                    type.description,
                    type.dividends_at_maturity && "No monthly interest: the savings and dividends are paid together at maturity.",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </p>
              )}
            </fieldset>
          )}
          <div className="sm:col-span-2">
            <Field label="Note for the Branch Manager (optional)" error={e.note}>
              <Textarea name="note" rows={2} defaultValue={defaults.note ?? ""} placeholder="For example: member's signed request letter is on file." />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

/** The Branch Manager approves the request, with an optional note for Accounts. */
export function ApproveLiquidationForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Approve" submitLabel="Approve and send to Accounts" variant="primary">
      {(e) => (
        <Field label="Note for Accounts (optional)" error={e.note}>
          <Textarea name="note" rows={2} placeholder="For example: member's signed request and passbook seen." />
        </Field>
      )}
    </InlineForm>
  );
}
