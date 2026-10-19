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
    counterparty: optionalText,
    reference: optionalText,
    description: z.string().trim().min(3, "Describe the transaction"),
    statement_line_id: optionalId,
  })
  .refine((v) => v.interest_amount < v.amount, { path: ["interest_amount"], message: "Interest must be less than the total amount" });

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
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
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
