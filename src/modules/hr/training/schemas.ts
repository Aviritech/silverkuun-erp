import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");

function optionalNumber(base: z.ZodNumber) {
  return z
    .literal("")
    .transform(() => null)
    .or(z.coerce.number().pipe(base));
}

export const trainingSchema = z
  .object({
    title: z.string().trim().min(1, "Enter the title").max(200, "Keep it under 200 characters"),
    description: optionalText,
    trainer: optionalText,
    starts_on: isoDate,
    ends_on: isoDate,
    hours: optionalNumber(z.number("Enter the hours").positive("Enter the hours").max(1000, "Enter the hours")),
    venue: optionalText,
    is_virtual: z.boolean(),
    meeting_url: z.url("Enter a full link, starting https://").nullable().or(z.literal("").transform(() => null)),
    capacity: optionalNumber(z.number("Enter a number").int("Enter a whole number").positive("Enter at least 1")),
    cost_per_person: optionalNumber(z.number("Enter an amount").nonnegative("Enter an amount")),
    pass_mark: optionalNumber(z.number("Enter a mark").int("Enter a whole number").min(0, "From 0 to 100").max(100, "From 0 to 100")),
    departments: z.array(z.string().min(1)),
  })
  .refine((v) => v.ends_on >= v.starts_on, { path: ["ends_on"], message: "The training must end on or after the start" })
  .refine((v) => !v.is_virtual || v.meeting_url, { path: ["meeting_url"], message: "Add the meeting link" })
  .refine((v) => v.is_virtual || v.venue, { path: ["venue"], message: "Enter the venue" });

export const enrolSchema = z.object({
  employee_id: z.guid("Choose the employee"),
});

export const resultSchema = z
  .object({
    status: z.enum(["completed", "no_show"], "Choose completed or didn't attend"),
    hours: optionalNumber(z.number("Enter the hours").nonnegative("Enter the hours").max(1000, "Enter the hours")),
    score: optionalNumber(z.number("Enter the score").min(0, "From 0 to 100").max(100, "From 0 to 100")),
  });

export const feedbackSchema = z.object({
  rating: z.coerce.number("Choose a rating").int("Choose a rating").min(1, "Choose a rating").max(5, "Choose a rating"),
  comment: optionalText,
});
