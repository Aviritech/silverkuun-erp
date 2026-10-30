import { z } from "zod";
import { ACCOUNT_TYPES, CASH_FLOW_CLASSES } from "./constants";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();
const optionalId = z.guid().nullable().or(z.literal("").transform(() => null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const notFuture = isoDate.refine((d) => d <= new Date().toISOString().slice(0, 10), "The date can't be in the future");
const money = z.coerce.number("Enter an amount").positive("Enter an amount above zero").multipleOf(0.01, "Use at most two decimal places");
const optionalCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,40}$/)
  .nullable()
  .or(z.literal("").transform(() => null));
const optionalPositive = z.coerce
  .number()
  .positive("Enter an amount above zero")
  .nullable()
  .or(z.literal("").transform(() => null));
const optionalMoney = z.coerce.number().min(0, "Can't be negative").multipleOf(0.01, "Use at most two decimal places").or(z.literal("").transform(() => 0));

export const transactionSchema = z
  .object({
    direction: z.enum(["receipt", "payment"]),
    transaction_type: z.string().min(1, "Choose what this is for"),
    bank_account_id: z.guid("Choose the bank or cash account"),
    txn_date: notFuture,
    amount: money,
    interest_amount: optionalMoney,
    member_id: optionalId,
    member_plan_id: optionalId,
    counterparty: optionalText,
    reference: optionalText,
    description: z.string().trim().min(3, "Describe the transaction"),
    statement_line_id: optionalId,
    department_code: optionalCode,
    plan_type: optionalCode,
    staff_id: optionalId,
    supplier_id: optionalId,
    supplier_bill_id: optionalId,
    loan_id: optionalId,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, such as USD")
      .or(z.literal("").transform(() => "NGN")),
    foreign_amount: optionalPositive,
    fx_rate: optionalPositive,
  })
  .refine((v) => v.interest_amount <= v.amount, { path: ["interest_amount"], message: "Interest can't be more than the total amount" })
  .refine((v) => !["loan_repayment", "loan_disbursement"].includes(v.transaction_type) || v.loan_id, {
    path: ["loan_id"],
    message: "Choose the loan",
  })
  .refine((v) => v.transaction_type !== "member_savings" || v.member_plan_id, {
    path: ["member_plan_id"],
    message: "Choose the savings plan the money was paid into",
  })
  .refine((v) => v.transaction_type !== "supplier_payment" || v.supplier_id, { path: ["supplier_id"], message: "Choose the supplier being paid" })
  .refine((v) => v.currency === "NGN" || v.foreign_amount, { path: ["foreign_amount"], message: "Enter the amount in the foreign currency" })
  .refine((v) => v.currency === "NGN" || v.fx_rate, { path: ["fx_rate"], message: "Enter the exchange rate used" })
  .refine(
    (v) => v.currency === "NGN" || !v.foreign_amount || !v.fx_rate || Math.round(v.foreign_amount * v.fx_rate * 100) === Math.round(v.amount * 100),
    { path: ["amount"], message: "The naira amount must equal the foreign amount times the rate" },
  )
  .transform((v) => (v.currency === "NGN" ? { ...v, foreign_amount: null, fx_rate: null } : v));

export const reasonSchema = z.object({ reason: z.string().trim().min(5, "Give a reason of at least a few words") });

export const journalLineSchema = z
  .object({
    account_code: z.string().regex(/^\d{4}$/, "Choose an account"),
    debit: optionalMoney,
    credit: optionalMoney,
    member_id: optionalId,
    description: optionalText,
  })
  .refine((l) => (l.debit > 0) !== (l.credit > 0), { message: "Each line needs a debit or a credit, not both" });

export const journalSchema = z
  .object({
    branch_id: z.guid("Choose a branch"),
    entry_date: notFuture,
    description: z.string().trim().min(3, "Describe the entry"),
    lines: z.array(journalLineSchema).min(2, "A journal needs at least two lines"),
  })
  .refine(
    (j) => Math.round(j.lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100) === 0,
    { path: ["lines"], message: "Debits must equal credits" },
  );

export const ledgerAccountSchema = z.object({
  code: z.string().regex(/^\d{4}$/, "Use a four-digit code"),
  name: z.string().trim().min(2, "Enter a name"),
  parent_code: z.string().regex(/^\d{4}$/, "Choose a parent heading"),
  account_type: z.enum(Object.keys(ACCOUNT_TYPES) as [keyof typeof ACCOUNT_TYPES]),
  cash_flow_class: z.enum(Object.keys(CASH_FLOW_CLASSES) as [keyof typeof CASH_FLOW_CLASSES]),
  description: z.string().trim().default(""),
});

export const bankAccountSchema = z.object({
  branch_id: z.guid("Choose a branch"),
  name: z.string().trim().min(2, "Enter a name"),
  kind: z.enum(["bank", "cash"]),
  bank_name: optionalText,
  account_number: optionalText,
  ledger_account_code: z.string().regex(/^\d{4}$/, "Choose the ledger account"),
});

export const postingRuleSchema = z.object({
  debit_account: z.string().regex(/^\d{4}$/).nullable().or(z.literal("").transform(() => null)),
  credit_account: z.string().regex(/^\d{4}$/).nullable().or(z.literal("").transform(() => null)),
  interest_account: z.string().regex(/^\d{4}$/).nullable().or(z.literal("").transform(() => null)),
  requires_member: z.enum(["true", "false"]).transform((v) => v === "true"),
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
  reason: z.string().trim().min(5, "Say why the rule should change"),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier's name"),
  contact_person: optionalText,
  phone: optionalText,
  email: z.email("Enter a valid email").nullable().or(z.literal("").transform(() => null)),
  address: optionalText,
  bank_name: optionalText,
  account_number: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "A NUBAN account number is 10 digits")
    .nullable()
    .or(z.literal("").transform(() => null)),
  tax_id: optionalText,
});

export const billSchema = z
  .object({
    supplier_id: z.guid("Choose the supplier"),
    branch_id: z.guid("Choose the branch"),
    department_code: optionalCode,
    bill_date: notFuture,
    due_date: isoDate,
    supplier_reference: z.string().trim().min(1, "Enter the supplier's invoice number"),
    expense_account: z.string().regex(/^\d{4}$/, "Choose what the bill is for"),
    amount: money,
    description: z.string().trim().min(3, "Describe what was supplied"),
  })
  .refine((b) => b.due_date >= b.bill_date, { path: ["due_date"], message: "The due date can't be before the bill date" });

export const accrualSchema = z.object({
  branch_id: z.guid("Choose the branch"),
  entry_date: notFuture,
  description: z.string().trim().min(3, "Describe the accrual"),
  members: z
    .array(z.object({ member_id: z.guid(), amount: money }))
    .min(1, "Enter an ROI amount for at least one member"),
});

export const mappingSchema = z.object({
  date: z.string().trim().min(1, "Name the date column"),
  description: z.string().trim().min(1, "Name the description column"),
  reference: z.string().trim(),
  debit: z.string().trim().min(1, "Name the debit (money out) column"),
  credit: z.string().trim().min(1, "Name the credit (money in) column"),
  balance: z.string().trim(),
});

export const reconciliationSchema = z.object({
  period_end: notFuture,
  statement_balance: z.coerce.number("Enter the statement balance").multipleOf(0.01, "Use at most two decimal places"),
  notes: optionalText,
});
