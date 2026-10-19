import { z } from "zod";
import {
  BUREAU_RESULTS,
  COLLATERAL_TYPES,
  CUSTOMER_CATEGORIES,
  INTEREST_METHODS,
  LOAN_DOCUMENT_TYPES,
  RATE_BASES,
  REMINDER_CHANNELS,
  REPAYMENT_FREQUENCIES,
  REPAYMENT_MODES,
  RISK_RATINGS,
} from "./constants";

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const today = () => new Date().toISOString().slice(0, 10);
const futureDate = isoDate.refine((d) => d > today(), "Choose a date after today");
const optionalFutureDate = futureDate.nullable().or(z.literal("").transform(() => null));
const money = z.coerce.number("Enter an amount").positive("Enter an amount above zero").multipleOf(0.01, "Use at most two decimal places");
const optionalMoney = z.coerce
  .number()
  .min(0, "Can't be negative")
  .multipleOf(0.01, "Use at most two decimal places")
  .nullable()
  .or(z.literal("").transform(() => null));
const rate = z.coerce.number("Enter the interest rate").min(0, "Can't be negative").max(100, "Enter a percentage up to 100");
const tenor = z.coerce.number("Enter the tenor").int("Use whole months").min(1, "At least one month").max(120, "At most 120 months");

const terms = {
  tenor_months: tenor,
  repayment_frequency: z.enum(keys(REPAYMENT_FREQUENCIES), "Choose how often it is repaid"),
  interest_rate: rate,
  rate_basis: z.enum(keys(RATE_BASES)),
  interest_method: z.enum(keys(INTEREST_METHODS), "Choose how interest is charged"),
};

const quarterly = (v: { repayment_frequency: string; tenor_months: number }) =>
  v.repayment_frequency !== "quarterly" || v.tenor_months % 3 === 0;

export const loanSchema = z
  .object({
    member_id: z.guid("Choose the customer"),
    product_code: z.string().min(1, "Choose a loan product"),
    account_officer_id: z.guid("Choose the account officer"),
    phone: z.string().trim().min(7, "Enter a phone number"),
    address: z.string().trim().min(1, "Enter the residential address"),
    customer_category: z.enum(keys(CUSTOMER_CATEGORIES), "Choose the customer category"),
    employer_name: optionalText,
    occupation: optionalText,
    employer_address: optionalText,
    monthly_income: optionalMoney,
    amount_requested: money,
    purpose: z.string().trim().min(3, "Say what the loan is for"),
    ...terms,
    repayment_mode: z.enum(keys(REPAYMENT_MODES), "Choose how it will be repaid"),
    first_repayment_date: optionalFutureDate,
  })
  .refine(quarterly, { path: ["tenor_months"], message: "A quarterly loan runs for a whole number of quarters" });
export type LoanInput = z.infer<typeof loanSchema>;

export const guarantorSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the guarantor's name"),
  phone: z.string().trim().min(7, "Enter a phone number"),
  address: z.string().trim().min(1, "Enter the address"),
  relationship: optionalText,
  occupation: optionalText,
  employer: optionalText,
  monthly_income: optionalMoney,
  is_member: z.enum(["on", ""]).optional().transform((v) => v === "on"),
});

export const collateralSchema = z.object({
  collateral_type: z.enum(keys(COLLATERAL_TYPES), "Choose the type"),
  description: z.string().trim().min(3, "Describe the collateral"),
  estimated_value: money,
  valuation_date: isoDate
    .refine((d) => d <= today(), "The valuation date can't be in the future")
    .nullable()
    .or(z.literal("").transform(() => null)),
  valued_by: optionalText,
});

export const loanDocumentSchema = z.object({
  document_type: z.enum(keys(LOAN_DOCUMENT_TYPES), "Choose a document type"),
});

export const appraisalSchema = z
  .object({
    bureau_check: z.enum(keys(BUREAU_RESULTS), "Record the credit bureau result"),
    bureau_name: optionalText,
    bureau_score: optionalText,
    risk_rating: z.enum(keys(RISK_RATINGS), "Choose a risk rating"),
    recommendation: z.enum(["approve", "decline"], "Say whether you recommend approval"),
    recommended_amount: optionalMoney,
    notes: z.string().trim().min(5, "Write up the appraisal: capacity to repay, character and security"),
  })
  .refine((v) => v.recommendation === "decline" || (v.recommended_amount ?? 0) > 0, {
    path: ["recommended_amount"],
    message: "Enter the amount you recommend",
  });

export const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    approved_amount: optionalMoney,
    note: optionalText,
  })
  .refine((v) => v.decision === "reject" || (v.approved_amount ?? 0) > 0, { path: ["approved_amount"], message: "Enter the amount approved" })
  .refine((v) => v.decision === "approve" || (v.note?.length ?? 0) >= 5, { path: ["note"], message: "Give the reason for rejecting" });

export const reasonSchema = z.object({ reason: z.string().trim().min(5, "Give a reason of a few words") });

export const restructureSchema = z
  .object({ ...terms, first_repayment_date: futureDate, reason: z.string().trim().min(5, "Say why the loan is being restructured") })
  .refine(quarterly, { path: ["tenor_months"], message: "A quarterly loan runs for a whole number of quarters" });

export const restructureDecisionSchema = z
  .object({ decision: z.enum(["approve", "reject"]), note: optionalText })
  .refine((v) => v.decision === "approve" || (v.note?.length ?? 0) >= 5, { path: ["note"], message: "Give the reason for declining" });

export const reminderSchema = z.object({
  kind: z.enum(["upcoming", "overdue"]),
  channel: z.enum(keys(REMINDER_CHANNELS), "Choose how you reached the customer"),
  due_date: isoDate.nullable().or(z.literal("").transform(() => null)),
  amount: optionalMoney,
  note: optionalText,
});

export const productSchema = z
  .object({
    code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,30}$/, "Use lower-case letters, numbers and underscores, such as school_fees"),
    name: z.string().trim().min(2, "Name the product"),
    description: z.string().trim(),
    interest_rate: rate,
    rate_basis: z.enum(keys(RATE_BASES)),
    interest_method: z.enum(keys(INTEREST_METHODS)),
    min_amount: z.coerce.number().min(0, "Can't be negative"),
    max_amount: optionalMoney,
    max_tenor_months: tenor,
    requires_guarantor: z.enum(["on", ""]).optional().transform((v) => v === "on"),
    requires_collateral: z.enum(["on", ""]).optional().transform((v) => v === "on"),
    requires_proforma: z.enum(["on", ""]).optional().transform((v) => v === "on"),
    is_active: z.enum(["on", ""]).optional().transform((v) => v === "on"),
  })
  .refine((v) => v.max_amount === null || v.max_amount >= v.min_amount, { path: ["max_amount"], message: "Must be at least the minimum" });
