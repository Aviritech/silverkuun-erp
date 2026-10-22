import { z } from "zod";
import { GOAL_TYPES } from "./constants";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const optionalDate = isoDate.nullable().or(z.literal("").transform(() => null));

export const newReviewSchema = z
  .object({
    employee_id: z.guid("Choose the employee"),
    period_label: z.string().trim().min(1, "Name the period, for example Q1 2026").max(60, "Keep it under 60 characters"),
    period_start: isoDate,
    period_end: isoDate,
  })
  .refine((v) => v.period_end >= v.period_start, { path: ["period_end"], message: "The period must end after it starts" });

export const scoreSchema = z.object({
  criterion: z.string().trim().min(1, "Enter what you are scoring").max(120, "Keep it under 120 characters"),
  target: optionalText,
  actual: optionalText,
  score: z.coerce.number("Choose a score").int("Choose a score").min(1, "Choose a score").max(5, "Choose a score"),
  comment: optionalText,
});

export const reviewNotesSchema = z.object({
  strengths: optionalText,
  improvements: optionalText,
  reviewer_comments: optionalText,
  next_review_date: optionalDate,
});

export const acknowledgeSchema = z.object({
  comments: optionalText,
});

export const goalSchema = z.object({
  employee_id: z.guid("Choose the employee"),
  title: z.string().trim().min(1, "Enter the goal").max(200, "Keep it under 200 characters"),
  goal_type: z.enum(Object.keys(GOAL_TYPES) as [keyof typeof GOAL_TYPES], "Choose the kind of goal"),
  target_date: optionalDate,
  description: optionalText,
});

export const progressSchema = z.object({
  progress: z.coerce.number("Enter a percentage").int("Enter a whole number").min(0, "From 0 to 100").max(100, "From 0 to 100"),
  note: optionalText,
});
