import { z } from "zod";
import { DOCUMENT_TYPES, FREQUENCIES, ID_TYPES, ISSUE_CHANNELS, MAX_SIGNATURE_LENGTH, PAYMENT_METHODS } from "./constants";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");

const optionalPayDay = z.coerce
  .number("Choose a day")
  .int()
  .min(1, "Choose a day from 1 to 31")
  .max(31, "Choose a day from 1 to 31")
  .nullable()
  .or(z.literal("").transform(() => null));

export const memberSchema = z.object({
  branch_id: z.guid("Choose a branch"),
  title: optionalText,
  first_name: z.string().trim().min(1, "Enter the first name"),
  middle_name: optionalText,
  last_name: z.string().trim().min(1, "Enter the last name"),
  date_of_birth: isoDate.nullable().or(z.literal("").transform(() => null)),
  gender: z.enum(["female", "male"]).nullable().or(z.literal("").transform(() => null)),
  phone: z.string().trim().min(7, "Enter a phone number"),
  email: z.email("Enter a valid email").nullable().or(z.literal("").transform(() => null)),
  address: z.string().trim().min(1, "Enter the address"),
  nin: z.string().trim().regex(/^\d{11}$/, "A NIN is 11 digits"),
  id_type: z.enum(Object.keys(ID_TYPES) as [keyof typeof ID_TYPES], "Choose an ID type"),
  id_number: z.string().trim().min(1, "Enter the ID number"),
  next_of_kin_name: optionalText,
  next_of_kin_phone: optionalText,
  next_of_kin_relationship: optionalText,
  bank_code: z
    .string()
    .regex(/^\d{3}$/, "Choose the bank")
    .nullable()
    .or(z.literal("").transform(() => null)),
  bank_name: optionalText,
  bank_account_no: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "An account number is 10 digits")
    .nullable()
    .or(z.literal("").transform(() => null)),
  interest_pay_day: optionalPayDay,
});
export type MemberInput = z.infer<typeof memberSchema>;

export const amendmentSchema = z.object({
  amendment_reason: z.string().trim().min(5, "Say why this approved record is being changed"),
});

export const documentSchema = z.object({
  document_type: z.enum(Object.keys(DOCUMENT_TYPES) as [keyof typeof DOCUMENT_TYPES], "Choose a document type"),
});

export const approvalSchema = z.object({
  signature: z
    .string()
    .max(MAX_SIGNATURE_LENGTH, "The signature is too large; clear it and sign again")
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, "Sign in the box before approving"),
});

export const issueSchema = z.object({
  issued_on: isoDate.refine((d) => d <= new Date().toISOString().slice(0, 10), "The issue date can't be in the future"),
  issue_channel: z.enum(Object.keys(ISSUE_CHANNELS) as [keyof typeof ISSUE_CHANNELS], "Choose how it was sent"),
  issue_note: optionalText,
});

export const targetSchema = z.object({
  branch_id: z.guid("Choose a branch"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month"),
  registrations: z.coerce.number("Enter a number").int("Use a whole number").min(0, "Can't be negative"),
  collections: z.coerce.number("Enter an amount").min(0, "Can't be negative").multipleOf(0.01, "Use at most two decimal places"),
});

export const marketerReviewSchema = z.object({
  note: z.string().trim().max(1000, "Keep the note under 1,000 characters"),
});

export const returnSchema = z.object({
  reason: z.string().trim().min(5, "Say what needs correcting"),
});

const money = z.coerce.number("Enter an amount").positive("Enter an amount above zero").multipleOf(0.01, "Use at most two decimal places");

export const planSchema = z
  .object({
    plan_type: z.string().min(1, "Choose a plan"),
    contribution_amount: money,
    contribution_frequency: z.enum(Object.keys(FREQUENCIES) as [keyof typeof FREQUENCIES], "Choose how often"),
    start_date: isoDate,
    maturity_date: isoDate,
  })
  .refine((v) => v.maturity_date > v.start_date, { path: ["maturity_date"], message: "Maturity must be after the start date" });

export const contributionSchema = z.object({
  member_plan_id: z.guid(),
  kind: z.enum(["scheduled", "top_up"]),
  amount: money,
  paid_on: isoDate.refine((d) => d <= new Date().toISOString().slice(0, 10), "Payment date can't be in the future"),
  payment_method: z.enum(Object.keys(PAYMENT_METHODS) as [keyof typeof PAYMENT_METHODS], "Choose how it was paid"),
  reference: optionalText,
});

export const reversalSchema = z.object({
  contribution_id: z.guid(),
  notes: z.string().trim().min(5, "Say why this entry is being reversed"),
});

/** Field errors keyed by field name, ready for a form to show. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
