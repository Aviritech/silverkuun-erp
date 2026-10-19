"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { COMMON_CURRENCIES } from "../constants";
import type { BankAccount, LoanOption, MemberOption, OpenBill, PostingRule, Supplier } from "../queries";

export type DimensionChoices = {
  departments: { code: string; name: string }[];
  products: { code: string; name: string }[];
  staff: { id: string; full_name: string }[];
  suppliers: Pick<Supplier, "id" | "name" | "is_active">[];
  openBills: OpenBill[];
};

export type TransactionDefaults = Partial<{
  transaction_type: string;
  bank_account_id: string;
  txn_date: string;
  amount: string;
  interest_amount: string;
  member_id: string | null;
  counterparty: string | null;
  reference: string | null;
  description: string;
  statement_line_id: string | null;
  department_code: string | null;
  plan_type: string | null;
  staff_id: string | null;
  supplier_id: string | null;
  supplier_bill_id: string | null;
  loan_id: string | null;
  currency: string;
  foreign_amount: string | null;
  fx_rate: string | null;
}>;

export function TransactionForm({
  action,
  direction,
  rules,
  banks,
  members,
  loans = [],
  dimensions,
  branchName,
  defaults = {},
  withEvidence,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  direction: "receipt" | "payment";
  rules: PostingRule[];
  banks: BankAccount[];
  members: MemberOption[];
  /** Approved and active loans, for loan disbursements and repayments. */
  loans?: LoanOption[];
  dimensions: DimensionChoices;
  branchName: Map<string, string>;
  defaults?: TransactionDefaults;
  withEvidence: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [type, setType] = useState(defaults.transaction_type ?? "");
  const [bankId, setBankId] = useState(defaults.bank_account_id ?? "");
  const [amount, setAmount] = useState(defaults.amount ?? "");
  const [supplierId, setSupplierId] = useState(defaults.supplier_id ?? "");
  const [billId, setBillId] = useState(defaults.supplier_bill_id ?? "");
  const [loanId, setLoanId] = useState(defaults.loan_id ?? "");
  const [currency, setCurrency] = useState(defaults.currency ?? "NGN");
  const [foreign, setForeign] = useState({ amount: defaults.foreign_amount ?? "", rate: defaults.fx_rate ?? "" });
  const rule = rules.find((r) => r.transaction_type === type);
  const bank = banks.find((b) => b.id === bankId);
  const e = state.fieldErrors ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const memberChoices = bank ? members.filter((m) => m.branch_id === bank.branch_id) : members;
  const isSupplierPayment = type === "supplier_payment";
  const loanStatus = type === "loan_repayment" ? "active" : type === "loan_disbursement" ? "approved" : null;
  const loanChoices = loans.filter((l) => l.status === loanStatus && (!bank || l.branch_id === bank.branch_id));
  const loan = loanStatus ? loans.find((l) => l.id === loanId) : undefined;
  const billChoices = dimensions.openBills.filter(
    (b) => (!supplierId || b.supplier_id === supplierId) && (!bank || b.branch_id === bank.branch_id),
  );
  const setForeignValue = (key: "amount" | "rate", value: string) => {
    const next = { ...foreign, [key]: value };
    setForeign(next);
    const product = Number(next.amount) * Number(next.rate);
    if (next.amount && next.rate && Number.isFinite(product)) setAmount((Math.round(product * 100) / 100).toFixed(2));
  };

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="statement_line_id" value={defaults.statement_line_id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={direction === "receipt" ? "What was received" : "What is being paid"} error={e.transaction_type}>
          <Select name="transaction_type" required value={type} onChange={(ev) => setType(ev.target.value)}>
            <option value="">Choose</option>
            {rules.map((r) => (
              <option key={r.transaction_type} value={r.transaction_type}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={direction === "receipt" ? "Paid into" : "Paid from"}
          error={e.bank_account_id}
          hint={bank ? `${branchName.get(bank.branch_id)} · ledger ${bank.ledger_account_code}` : undefined}
        >
          <Select name="bank_account_id" required value={bankId} onChange={(ev) => setBankId(ev.target.value)}>
            <option value="">Choose</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({branchName.get(b.branch_id)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={e.txn_date}>
          <Input name="txn_date" type="date" max={today} defaultValue={defaults.txn_date ?? today} required />
        </Field>
        <Field
          label="Amount (₦)"
          error={e.amount}
          hint={currency !== "NGN" ? `Worked out from the ${currency} amount and rate.` : undefined}
        >
          <Input
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(ev) => setAmount(ev.target.value)}
            readOnly={currency !== "NGN"}
            required
          />
        </Field>
        {loanStatus && (
          <Field
            label={loanStatus === "active" ? "Loan being repaid" : "Loan being paid out"}
            error={e.loan_id}
            hint={
              loan
                ? loanStatus === "active"
                  ? `${loan.member_name} · owes ₦${loan.outstanding.toLocaleString("en-NG")}${loan.overdue ? `, ₦${loan.overdue.toLocaleString("en-NG")} overdue` : ""}`
                  : `${loan.member_name} · approved ₦${Number(loan.approved_amount).toLocaleString("en-NG")}`
                : loanStatus === "active"
                  ? "Active loans in the account's branch, from Credit."
                  : "Approved loans waiting to be paid out."
            }
          >
            <Select
              name="loan_id"
              required
              value={loanId}
              onChange={(ev) => {
                setLoanId(ev.target.value);
                const chosen = loans.find((l) => l.id === ev.target.value);
                if (chosen && loanStatus === "approved") setAmount(chosen.approved_amount);
              }}
            >
              <option value="">Choose</option>
              {loanChoices.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.loan_no} · {l.member_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {rule?.interest_account && !loanStatus && (
          <Field label="Of which interest (₦)" error={e.interest_amount} hint="The rest is applied to the loan principal.">
            <Input name="interest_amount" type="number" min="0" step="0.01" defaultValue={defaults.interest_amount ?? ""} />
          </Field>
        )}
        {loanStatus ? (
          <input type="hidden" name="member_id" value={loan?.member_id ?? ""} />
        ) : (
          <Field
            label={rule?.requires_member ? "Member" : "Member (optional)"}
            error={e.member_id}
            hint={bank ? "Approved members of the account's branch." : "Choose the account first to narrow this list."}
          >
            <Select name="member_id" defaultValue={defaults.member_id ?? ""} required={rule?.requires_member}>
              <option value="">{rule?.requires_member ? "Choose" : "None"}</option>
              {memberChoices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.membership_no ? ` (${m.membership_no})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {direction === "payment" && (
          <Field label={isSupplierPayment ? "Supplier" : "Supplier (optional)"} error={e.supplier_id}>
            <Select
              name="supplier_id"
              value={supplierId}
              required={isSupplierPayment}
              onChange={(ev) => {
                setSupplierId(ev.target.value);
                setBillId("");
              }}
            >
              <option value="">{isSupplierPayment ? "Choose" : "None"}</option>
              {dimensions.suppliers
                .filter((x) => x.is_active || x.id === supplierId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {isSupplierPayment && (
          <Field label="Bill being paid (optional)" error={e.supplier_bill_id} hint="Approved bills with money still owed.">
            <Select
              name="supplier_bill_id"
              value={billId}
              onChange={(ev) => {
                setBillId(ev.target.value);
                const bill = dimensions.openBills.find((b) => b.id === ev.target.value);
                if (bill) {
                  setSupplierId(bill.supplier_id);
                  if (currency === "NGN") setAmount(bill.outstanding);
                }
              }}
            >
              <option value="">Not against a bill</option>
              {billChoices.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bill_no} · {b.supplier_reference} · owed ₦{Number(b.outstanding).toLocaleString("en-NG")}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={direction === "receipt" ? "Received from" : "Beneficiary"} error={e.counterparty}>
          <Input name="counterparty" defaultValue={defaults.counterparty ?? ""} />
        </Field>
        <Field label="Reference" error={e.reference} hint="Bank transfer, teller or invoice reference. Must be unique on the account.">
          <Input name="reference" defaultValue={defaults.reference ?? ""} />
        </Field>
      </div>
      <details className="rounded-md border border-zinc-200 px-3 py-2" open={Boolean(defaults.department_code || defaults.plan_type || defaults.staff_id || (defaults.currency && defaults.currency !== "NGN"))}>
        <summary className="cursor-pointer text-sm font-medium">Reporting details and foreign currency</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="Department" error={e.department_code}>
            <Select name="department_code" defaultValue={defaults.department_code ?? ""}>
              <option value="">Not set</option>
              {dimensions.departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Product" error={e.plan_type}>
            <Select name="plan_type" defaultValue={defaults.plan_type ?? ""}>
              <option value="">Not set</option>
              {dimensions.products.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Staff member" error={e.staff_id} hint="For salaries, allowances and staff advances.">
            <Select name="staff_id" defaultValue={defaults.staff_id ?? ""}>
              <option value="">Not set</option>
              {dimensions.staff.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" error={e.currency}>
            <Select name="currency" value={currency} onChange={(ev) => setCurrency(ev.target.value)}>
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c === "NGN" ? "Naira (NGN)" : c}
                </option>
              ))}
            </Select>
          </Field>
          {currency !== "NGN" && (
            <>
              <Field label={`Amount in ${currency}`} error={e.foreign_amount}>
                <Input
                  name="foreign_amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={foreign.amount}
                  onChange={(ev) => setForeignValue("amount", ev.target.value)}
                  required
                />
              </Field>
              <Field label={`Rate (₦ per ${currency})`} error={e.fx_rate}>
                <Input
                  name="fx_rate"
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={foreign.rate}
                  onChange={(ev) => setForeignValue("rate", ev.target.value)}
                  required
                />
              </Field>
            </>
          )}
        </div>
      </details>
      <Field label="Description" error={e.description}>
        <Textarea name="description" rows={2} defaultValue={defaults.description ?? ""} required />
      </Field>
      {withEvidence && (
        <Field
          label={direction === "receipt" ? "Evidence (teller, transfer receipt or screenshot)" : "Supporting document (invoice or approval)"}
          error={e.file}
          hint="PDF, JPEG or PNG up to 10 MB. Needed before you submit; you can also add it on the next page."
        >
          <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" />
        </Field>
      )}
      {type === "loan_repayment" && (
        <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
          The split between interest and principal is worked out from the loan&apos;s schedule when this posts: the oldest instalment first,
          interest before principal.
        </p>
      )}
      {rule && (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          Posts as: debit {rule.debit_account ?? (bank ? `${bank.ledger_account_code} ${bank.name}` : "the bank account")}, credit{" "}
          {rule.credit_account ?? (bank ? `${bank.ledger_account_code} ${bank.name}` : "the bank account")}
          {rule.interest_account ? `, interest to ${rule.interest_account}` : ""}.
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
