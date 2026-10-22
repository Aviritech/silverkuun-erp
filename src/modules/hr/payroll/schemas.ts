import { z } from "zod";
import { ADJUSTMENT_KINDS, DEDUCTION_KINDS } from "./constants";

/** A month picker gives "YYYY-MM"; the database wants the first of the month. */
const month = (message: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}(-01)?$/, message)
    .transform((v) => `${v.slice(0, 7)}-01`);

const optionalMonth = z
  .string()
  .regex(/^\d{4}-\d{2}(-01)?$/, "Choose a month")
  .transform((v) => `${v.slice(0, 7)}-01`)
  .nullable()
  .or(z.literal("").transform(() => null));

const amount = (message: string) => z.coerce.number(message).min(0, message).max(1_000_000_000_000, "That amount is too large");
const positive = (message: string) => z.coerce.number(message).gt(0, message).max(1_000_000_000_000, "That amount is too large");
const optionalAmount = z
  .literal("")
  .transform(() => null)
  .or(positive("Enter an amount above zero"));
const rate = z.coerce.number("Enter a percentage").min(0, "Enter 0 to 100").max(100, "Enter 0 to 100");

function choice<T extends Record<string, unknown>>(choices: T, message: string) {
  return z.enum(Object.keys(choices) as [Extract<keyof T, string>], message);
}

export const runSchema = z.object({
  period: month("Choose the month"),
  note: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v)),
});

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, "Say why"),
});

export const salarySchema = z.object({
  effective_from: month("Choose the month it starts"),
  basic: positive("Enter the basic pay"),
  housing: amount("Enter 0 or more"),
  transport: amount("Enter 0 or more"),
  medical: amount("Enter 0 or more"),
  utility: amount("Enter 0 or more"),
  other_allowance: amount("Enter 0 or more"),
  reason: z.string().trim().min(3, "Say why, for example appointment, promotion or annual review"),
});

export const deductionSchema = z
  .object({
    kind: choice(DEDUCTION_KINDS, "Choose the kind"),
    description: z.string().trim().min(2, "Describe the deduction"),
    monthly_amount: positive("Enter the monthly amount"),
    total_amount: optionalAmount,
    start_month: month("Choose the first month"),
    end_month: optionalMonth,
  })
  .refine((v) => !v.end_month || v.end_month >= v.start_month, {
    path: ["end_month"],
    message: "The last month can't be before the first",
  });

export const adjustmentSchema = z.object({
  employee_id: z.guid("Choose an employee"),
  kind: choice(ADJUSTMENT_KINDS, "Choose the kind"),
  description: z.string().trim().min(2, "Describe it"),
  amount: positive("Enter an amount above zero"),
  taxable: z.boolean(),
});

export const bandSchema = z.object({ upto: z.number().gt(0).nullable(), rate: z.number().min(0).max(100) });

export const settingsSchema = z.object({
  effective_from: month("Choose the month these start"),
  pension_employee_rate: rate,
  pension_employer_rate: rate,
  nhf_rate: rate,
  rent_relief_rate: rate,
  rent_relief_cap: amount("Enter the cap"),
  note: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v)),
});
