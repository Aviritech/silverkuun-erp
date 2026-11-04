"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { InlineForm } from "@/components/inline-form";
import type { ActionState } from "@/lib/action-state";
import type { CbnBank } from "../queries";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type LiquidationDefaults = {
  amount: string;
  beneficiary_account_name: string;
  bank_code: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  note?: string | null;
};

/** Operations raises (or corrects) a request to pay out a member's savings, with the account to pay into. */
export function LiquidationForm({
  action,
  banks,
  defaults,
  savings,
  openLabel = "Request liquidation",
  submitLabel = "Send to the Branch Manager",
}: {
  action: Action;
  banks: CbnBank[];
  defaults: LiquidationDefaults;
  /** The plan's verified savings, shown so the officer can check the amount. */
  savings: string;
  openLabel?: string;
  submitLabel?: string;
}) {
  const [bankChoice, setBankChoice] = useState(defaults.bank_code ?? (defaults.bank_name ? "other" : ""));
  return (
    <InlineForm action={action} openLabel={openLabel} submitLabel={submitLabel} variant="secondary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Amount to pay (₦)"
            error={e.amount}
            hint={`Verified savings in this plan: ₦${Number(savings).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`}
          >
            <Input name="amount" inputMode="decimal" defaultValue={defaults.amount} required />
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
