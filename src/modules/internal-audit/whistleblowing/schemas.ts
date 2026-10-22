import { z } from "zod";
import { CASE_STATUSES, SPEAK_UP_CATEGORIES } from "./constants";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();
const today = () => new Date().toISOString().slice(0, 10);

export const reportSchema = z.object({
  category: z.enum(Object.keys(SPEAK_UP_CATEGORIES) as [keyof typeof SPEAK_UP_CATEGORIES], "Choose what it is about"),
  title: z.string().trim().min(5, "Write a short title, at least 5 characters").max(200, "Keep the title under 200 characters"),
  description: z.string().trim().min(20, "Say what happened, in at least 20 characters"),
  incident_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
    .refine((d) => d <= today(), "The date can't be in the future")
    .nullable()
    .or(z.literal("").transform(() => null)),
  location: optionalText,
  people_involved: optionalText,
  anonymous: z.boolean(),
});

export const accessSchema = z.object({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^SU-[0-9A-F]{8}$/, "A reference looks like SU-1A2B3C4D"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-F]{4}-?[0-9A-F]{4}-?[0-9A-F]{4}$/, "An access code looks like 1A2B-3C4D-5E6F"),
});

export const messageSchema = z.object({
  body: z.string().trim().min(1, "Write a message").max(5000, "Keep it under 5,000 characters"),
});

export const caseUpdateSchema = z
  .object({
    status: z.enum(Object.keys(CASE_STATUSES) as [keyof typeof CASE_STATUSES], "Choose a status"),
    findings: optionalText,
    outcome: optionalText,
  })
  .refine((v) => !["resolved", "dismissed"].includes(v.status) || (v.outcome?.length ?? 0) >= 5, {
    path: ["outcome"],
    message: "Record the outcome before closing the case",
  });
