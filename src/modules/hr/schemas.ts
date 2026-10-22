import { z } from "zod";
import {
  CONTRACT_TYPES,
  DOCUMENT_TYPES,
  EMPLOYMENT_TYPES,
  EXIT_KINDS,
  ID_TYPES,
  JOB_CHANGES,
  MARITAL_STATUSES,
  QUALIFICATION_KINDS,
  RELATIONSHIPS,
} from "./constants";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const optionalDate = isoDate.nullable().or(z.literal("").transform(() => null));
const today = () => new Date().toISOString().slice(0, 10);
const notFuture = (message: string) => isoDate.refine((d) => d <= today(), message);

function optionalChoice<T extends Record<string, unknown>>(choices: T) {
  return z
    .enum(Object.keys(choices) as [Extract<keyof T, string>], "Choose from the list")
    .nullable()
    .or(z.literal("").transform(() => null));
}

function choice<T extends Record<string, unknown>>(choices: T, message: string) {
  return z.enum(Object.keys(choices) as [Extract<keyof T, string>], message);
}

/** Everything HR can correct on the record at any time. */
export const personalSchema = z.object({
  title: optionalText,
  first_name: z.string().trim().min(1, "Enter the first name"),
  middle_name: optionalText,
  last_name: z.string().trim().min(1, "Enter the last name"),
  date_of_birth: optionalDate,
  gender: z.enum(["female", "male"]).nullable().or(z.literal("").transform(() => null)),
  marital_status: optionalChoice(MARITAL_STATUSES),
  phone: z.string().trim().min(7, "Enter a phone number"),
  personal_email: z.email("Enter a valid email").nullable().or(z.literal("").transform(() => null)),
  work_email: z.email("Enter a valid email").nullable().or(z.literal("").transform(() => null)),
  address: z.string().trim().min(1, "Enter the address"),
  state_of_origin: optionalText,
  nationality: optionalText,
  nin: z
    .string()
    .trim()
    .regex(/^\d{11}$/, "A NIN is 11 digits")
    .nullable()
    .or(z.literal("").transform(() => null)),
  id_type: optionalChoice(ID_TYPES),
  id_number: optionalText,
  emergency_contact_name: optionalText,
  emergency_contact_phone: optionalText,
  emergency_contact_relationship: optionalText,
  bank_name: optionalText,
  bank_account_number: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "A NUBAN account number is 10 digits")
    .nullable()
    .or(z.literal("").transform(() => null)),
  pension_administrator: optionalText,
  pension_pin: optionalText,
  tax_id: optionalText,
  annual_rent: z
    .literal("")
    .transform(() => null)
    .or(z.coerce.number("Enter the annual rent in naira").min(0, "Enter the annual rent in naira")),
  // Checkboxes send "on" when ticked and nothing when not.
  pension_applies: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  nhf_applies: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  employment_type: choice(EMPLOYMENT_TYPES, "Choose the employment type"),
  hire_date: isoDate,
  probation_end_date: optionalDate,
});

/** A new starter: the record plus where they work. Branch, department and title change later only through job changes. */
export const newEmployeeSchema = personalSchema
  .extend({
    branch_id: z.guid("Choose a branch"),
    department_code: z.string().min(1, "Choose a department"),
    job_title_id: z.guid("Choose a job title"),
    employee_no: optionalText,
    status: z.enum(["probation", "active"]).default("probation"),
  })
  .refine((v) => !v.probation_end_date || v.probation_end_date >= v.hire_date, {
    path: ["probation_end_date"],
    message: "Probation can't end before the hire date",
  });
export type NewEmployeeInput = z.infer<typeof newEmployeeSchema>;

export const editEmployeeSchema = personalSchema.refine((v) => !v.probation_end_date || v.probation_end_date >= v.hire_date, {
  path: ["probation_end_date"],
  message: "Probation can't end before the hire date",
});

export const confirmSchema = z.object({
  confirmed_on: notFuture("The confirmation date can't be in the future"),
});

export const jobChangeSchema = z.object({
  event: choice(JOB_CHANGES, "Choose the kind of change"),
  branch_id: z.guid("Choose a branch"),
  department_code: z.string().min(1, "Choose a department"),
  job_title_id: z.guid("Choose a job title"),
  effective_date: isoDate,
  reason: z.string().trim().min(5, "Give the reason for the change"),
});

export const exitSchema = z.object({
  kind: choice(EXIT_KINDS, "Choose resigned or terminated"),
  exit_date: notFuture("Record the exit on or after the last working day"),
  reason: z.string().trim().min(5, "Give the reason for leaving"),
});

export const reinstateSchema = z.object({
  reason: z.string().trim().min(5, "Give the reason for reinstating"),
});

export const contractSchema = z
  .object({
    contract_type: choice(CONTRACT_TYPES, "Choose the contract type"),
    start_date: isoDate,
    end_date: optionalDate,
    notes: optionalText,
  })
  .refine((v) => v.contract_type === "permanent" || v.end_date, { path: ["end_date"], message: "Enter the end date" })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, { path: ["end_date"], message: "The end date must be after the start" });

export const contractEndSchema = z.object({
  contract_id: z.guid(),
  end_date: isoDate,
  notes: optionalText,
});

export const dependentSchema = z.object({
  full_name: z.string().trim().min(1, "Enter the name"),
  relationship: choice(RELATIONSHIPS, "Choose the relationship"),
  date_of_birth: optionalDate.refine((d) => !d || d <= today(), "The date of birth can't be in the future"),
});

export const qualificationSchema = z.object({
  kind: choice(QUALIFICATION_KINDS, "Choose the kind"),
  qualification: z.string().trim().min(1, "Enter the qualification"),
  course: optionalText,
  institution: optionalText,
  year_obtained: z.coerce
    .number("Enter a year")
    .int("Enter a year")
    .min(1950, "Enter a year from 1950")
    .max(2100, "Enter a real year")
    .nullable()
    .or(z.literal("").transform(() => null)),
  expires_on: optionalDate,
});

export const documentSchema = z.object({
  document_type: choice(DOCUMENT_TYPES, "Choose a document type"),
});

export const jobTitleSchema = z.object({
  name: z.string().trim().min(2, "Enter the job title").max(80, "Keep it under 80 characters"),
});
