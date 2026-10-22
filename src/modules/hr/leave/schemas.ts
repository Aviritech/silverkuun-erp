import { z } from "zod";
import { APPROVAL_SCOPES, EVIDENCE_TYPES } from "./constants";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const optionalGuid = (message: string) => z.guid(message).nullable().or(z.literal("").transform(() => null));

const wholeDays = (message: string) => z.coerce.number(message).int(message).min(0, message).max(366, "That is more than a year");
const optionalDays = (message: string) =>
  z
    .literal("")
    .transform(() => null)
    .or(wholeDays(message))
    .nullable();

export const requestLeaveSchema = z
  .object({
    leave_type_id: z.guid("Choose the kind of leave"),
    start_date: isoDate,
    end_date: isoDate,
    reason: optionalText,
    relief_employee_id: optionalGuid("Choose a colleague from the list"),
    // Only used when a file is attached.
    document_type: z
      .enum(Object.keys(EVIDENCE_TYPES) as [keyof typeof EVIDENCE_TYPES], "Choose what the document is")
      .or(z.literal("").transform(() => "other" as const)),
  })
  .refine((v) => v.end_date >= v.start_date, { path: ["end_date"], message: "The leave must end on or after the day it starts" })
  .refine((v) => v.start_date.slice(0, 4) === v.end_date.slice(0, 4), {
    path: ["end_date"],
    message: "Split leave that crosses into a new year into two requests",
  });

export const recordLeaveSchema = requestLeaveSchema.and(z.object({ employee_id: z.guid("Choose the employee") }));

export const approveSchema = z.object({ comment: optionalText });

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, "Say why"),
});

export const cancelSchema = z.object({ reason: optionalText });

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(2, "Enter the name").max(80, "Keep it under 80 characters"),
  days_per_year: wholeDays("Enter the days a year"),
  max_days_per_request: optionalDays("Enter a whole number of days").refine((v) => v === null || v > 0, "Enter at least 1, or leave blank"),
  document_after_days: optionalDays("Enter a whole number of days"),
  extra_days_after_5_years: wholeDays("Enter a whole number of days"),
  extra_days_after_10_years: wholeDays("Enter a whole number of days"),
  is_paid: z.boolean(),
  uses_balance: z.boolean(),
  prorate: z.boolean(),
  only_for_gender: z.enum(["female", "male"]).nullable().or(z.literal("").transform(() => null)),
});

export const approvalStepSchema = z.object({
  name: z.string().trim().min(2, "Name the step").max(80, "Keep it under 80 characters"),
  job_title_ids: z.array(z.guid()).min(1, "Choose at least one job title"),
  scope: z.enum(Object.keys(APPROVAL_SCOPES) as [keyof typeof APPROVAL_SCOPES], "Choose where the approver works"),
  same_department: z.boolean(),
});

export const holidaySchema = z.object({
  holiday_date: isoDate,
  name: z.string().trim().min(2, "Name the holiday").max(80, "Keep it under 80 characters"),
});
