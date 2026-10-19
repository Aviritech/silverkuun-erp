"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatDate, formatMoney } from "@/lib/format";
import {
  CUSTOMER_CATEGORIES,
  INTEREST_METHODS,
  RATE_BASES,
  REPAYMENT_FREQUENCIES,
  REPAYMENT_MODES,
  type InterestMethod,
  type RateBasis,
  type RepaymentFrequency,
} from "../constants";
import type { Loan, LoanProduct } from "../queries";
import { loanSchedule } from "../schedule";

export type MemberChoice = {
  id: string;
  name: string;
  membership_no: string | null;
  branch_id: string;
  phone: string;
  address: string;
};

type Officer = { id: string; full_name: string };

export function LoanForm({
  action,
  products,
  members,
  officersByBranch,
  branchName,
  loan,
  defaultOfficerId,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  products: LoanProduct[];
  /** Approved members the officer can raise a loan for. Not shown when editing. */
  members?: MemberChoice[];
  officersByBranch: Record<string, Officer[]>;
  branchName: Record<string, string>;
  loan?: Loan;
  defaultOfficerId?: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  const [memberId, setMemberId] = useState(loan?.member_id ?? (members?.length === 1 ? members[0].id : ""));
  const member = members?.find((m) => m.id === memberId);
  const branchId = loan?.branch_id ?? member?.branch_id;
  const officers = branchId ? (officersByBranch[branchId] ?? []) : [];

  const [productCode, setProductCode] = useState(loan?.product_code ?? "");
  const product = products.find((p) => p.code === productCode);
  const [terms, setTerms] = useState({
    amount: loan?.amount_requested ?? "",
    tenor: loan ? String(loan.tenor_months) : "",
    frequency: (loan?.repayment_frequency ?? "monthly") as RepaymentFrequency,
    rate: loan?.interest_rate ?? "",
    basis: (loan?.rate_basis ?? "per_month") as RateBasis,
    method: (loan?.interest_method ?? "flat") as InterestMethod,
    firstDue: loan?.first_repayment_date ?? "",
    income: loan?.monthly_income ?? "",
  });
  const set = (key: keyof typeof terms, value: string) => setTerms((t) => ({ ...t, [key]: value }));

  function chooseProduct(code: string) {
    setProductCode(code);
    const p = products.find((x) => x.code === code);
    if (p) setTerms((t) => ({ ...t, rate: p.interest_rate, basis: p.rate_basis, method: p.interest_method }));
  }

  const today = new Date().toISOString().slice(0, 10);
  const schedule = useMemo(
    () =>
      loanSchedule({
        principal: Number(terms.amount),
        interestRate: Number(terms.rate),
        rateBasis: terms.basis,
        interestMethod: terms.method,
        frequency: terms.frequency,
        tenorMonths: Number(terms.tenor),
        start: today,
        firstDue: terms.firstDue || null,
      }),
    [terms, today],
  );
  const totalInterest = schedule.reduce((s, l) => s + l.interest_due, 0);
  const instalment = schedule.length ? schedule[0].principal_due + schedule[0].interest_due : 0;
  const perMonth = terms.frequency === "weekly" ? (instalment * 52) / 12 : terms.frequency === "quarterly" ? instalment / 3 : instalment;
  const burden = Number(terms.income) > 0 && terms.frequency !== "end_of_term" ? perMonth / Number(terms.income) : null;

  return (
    <form action={formAction} className="space-y-6">
      <FormError message={state.error} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Customer</legend>
        {members ? (
          <Field label="Customer (approved member)" error={e.member_id} hint={member ? `${branchName[member.branch_id]} branch` : undefined}>
            <Select name="member_id" required value={memberId} onChange={(ev) => setMemberId(ev.target.value)}>
              <option value="">Choose</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.membership_no ? ` (${m.membership_no})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="member_id" value={loan?.member_id} />
        )}
        <Field label="Account officer" error={e.account_officer_id} hint={branchId ? undefined : "Choose the customer first."}>
          <Select
            name="account_officer_id"
            required
            key={branchId ?? "none"}
            defaultValue={loan?.account_officer_id ?? (officers.some((o) => o.id === defaultOfficerId) ? defaultOfficerId : "")}
          >
            <option value="">Choose</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phone number" error={e.phone}>
          <Input name="phone" key={`phone-${memberId}`} defaultValue={loan?.phone ?? member?.phone ?? ""} required />
        </Field>
        <Field label="Residential address" error={e.address}>
          <Input name="address" key={`address-${memberId}`} defaultValue={loan?.address ?? member?.address ?? ""} required />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">Employment or business</legend>
        <Field label="Customer category" error={e.customer_category}>
          <Select name="customer_category" required defaultValue={loan?.customer_category ?? ""}>
            <option value="">Choose</option>
            {Object.entries(CUSTOMER_CATEGORIES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Employer or business name" error={e.employer_name}>
          <Input name="employer_name" defaultValue={loan?.employer_name ?? ""} />
        </Field>
        <Field label="Occupation or line of business" error={e.occupation}>
          <Input name="occupation" defaultValue={loan?.occupation ?? ""} />
        </Field>
        <Field label="Employer or business address" error={e.employer_address}>
          <Input name="employer_address" defaultValue={loan?.employer_address ?? ""} />
        </Field>
        <Field label="Monthly income (₦)" error={e.monthly_income} hint="Net salary or average monthly business income.">
          <Input name="monthly_income" type="number" min="0" step="0.01" value={terms.income} onChange={(ev) => set("income", ev.target.value)} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-700">The loan</legend>
        <Field
          label="Loan product"
          error={e.product_code}
          hint={
            product
              ? `${formatMoney(product.min_amount)} to ${product.max_amount ? formatMoney(product.max_amount) : "no limit"}, up to ${product.max_tenor_months} months`
              : undefined
          }
        >
          <Select name="product_code" required value={productCode} onChange={(ev) => chooseProduct(ev.target.value)}>
            <option value="">Choose</option>
            {products
              .filter((p) => p.is_active || p.code === loan?.product_code)
              .map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Amount requested (₦)" error={e.amount_requested}>
          <Input name="amount_requested" type="number" min="1" step="0.01" value={terms.amount} onChange={(ev) => set("amount", ev.target.value)} required />
        </Field>
        <Field label="Duration (months)" error={e.tenor_months}>
          <Input
            name="tenor_months"
            type="number"
            min="1"
            max={product?.max_tenor_months ?? 120}
            step="1"
            value={terms.tenor}
            onChange={(ev) => set("tenor", ev.target.value)}
            required
          />
        </Field>
        <Field label="Repayment frequency" error={e.repayment_frequency}>
          <Select name="repayment_frequency" value={terms.frequency} onChange={(ev) => set("frequency", ev.target.value)}>
            {Object.entries(REPAYMENT_FREQUENCIES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Interest rate" error={e.interest_rate} hint="Filled in from the product; change it only if agreed.">
          <div className="flex gap-2">
            <Input name="interest_rate" type="number" min="0" max="100" step="0.0001" value={terms.rate} onChange={(ev) => set("rate", ev.target.value)} required />
            <Select name="rate_basis" value={terms.basis} onChange={(ev) => set("basis", ev.target.value)} aria-label="Rate basis">
              {Object.entries(RATE_BASES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label="Interest method" error={e.interest_method}>
          <Select name="interest_method" value={terms.method} onChange={(ev) => set("method", ev.target.value)}>
            {Object.entries(INTEREST_METHODS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Repayment method" error={e.repayment_mode}>
          <Select name="repayment_mode" required defaultValue={loan?.repayment_mode ?? ""}>
            <option value="">Choose</option>
            {Object.entries(REPAYMENT_MODES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="First repayment date (optional)" error={e.first_repayment_date} hint="Leave blank for one period after the money is paid out.">
          <Input name="first_repayment_date" type="date" min={today} value={terms.firstDue} onChange={(ev) => set("firstDue", ev.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <Field label="Purpose of the loan" error={e.purpose}>
            <Textarea name="purpose" rows={2} defaultValue={loan?.purpose ?? ""} required />
          </Field>
        </div>
      </fieldset>

      {schedule.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-silver-50/60 p-4 text-sm">
          <p className="font-medium text-ink">Estimated repayments</p>
          <dl className="mt-2 grid gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-500">Instalments</dt>
              <dd>
                {schedule.length} × {formatMoney(instalment)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Total interest</dt>
              <dd>{formatMoney(totalInterest)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Total to repay</dt>
              <dd>{formatMoney(Number(terms.amount) + totalInterest)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Share of monthly income</dt>
              <dd className={burden !== null && burden > 0.33 ? "font-medium text-red-700" : undefined}>
                {burden === null ? "—" : `${Math.round(burden * 100)}%`}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-zinc-500">
            If paid out today, the first repayment falls due {formatDate(schedule[0].due_date)} and the last {formatDate(schedule.at(-1)!.due_date)}.
            The final schedule is set on the day Accounts pays the loan out.
          </p>
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
