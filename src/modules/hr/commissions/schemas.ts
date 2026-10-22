import { z } from "zod";
import { COMMISSION_METHODS, type Tier } from "./constants";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const today = () => new Date().toISOString().slice(0, 10);
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();
const money = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, message))
    .transform(Number)
    .refine((v) => v > 0, message);
const optionalNumber = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v.replace(/,/g, ""))))
  .nullable();

/** A new commission target. Tiers arrive as parallel lists of "up to" and "rate"; the last band has no "up to". */
export const targetSchema = z
  .object({
    employee_id: z.guid("Choose the employee"),
    name: z.string().trim().min(3, "Give the target a name, such as “Q1 2027 loans”"),
    period_start: isoDate,
    period_end: isoDate,
    target_amount: money("Enter the target amount"),
    method: z.enum(Object.keys(COMMISSION_METHODS) as [keyof typeof COMMISSION_METHODS], "Choose how commission is worked out"),
    rate: optionalNumber,
    flat_amount: optionalNumber,
    tier_upto: z.array(z.string()),
    tier_rate: z.array(z.string()),
  })
  .transform((v, ctx) => {
    const issue = (path: string, message: string) => {
      ctx.addIssue({ code: "custom", path: [path], message });
      return z.NEVER;
    };
    if (v.period_end < v.period_start) return issue("period_end", "The period has to end after it starts");

    let rate: number | null = null;
    let flat_amount: number | null = null;
    let tiers: Tier[] | null = null;
    if (v.method === "percent_of_sales" || v.method === "percent_of_target_if_met") {
      if (v.rate === null || !Number.isFinite(v.rate) || v.rate <= 0 || v.rate > 100) return issue("rate", "Enter a rate between 0 and 100");
      rate = v.rate;
    } else if (v.method === "flat_if_met") {
      if (v.flat_amount === null || !Number.isFinite(v.flat_amount) || v.flat_amount <= 0) return issue("flat_amount", "Enter the amount");
      flat_amount = v.flat_amount;
    } else {
      const rows = v.tier_rate
        .map((r, i) => ({ upto: (v.tier_upto[i] ?? "").trim().replace(/,/g, ""), rate: r.trim() }))
        .filter((r) => r.upto !== "" || r.rate !== "");
      if (rows.length === 0) return issue("tiers", "Add at least one band");
      tiers = [];
      let lower = 0;
      for (const [i, row] of rows.entries()) {
        const last = i === rows.length - 1;
        const rateValue = Number(row.rate);
        if (row.rate === "" || !Number.isFinite(rateValue) || rateValue < 0 || rateValue > 100) {
          return issue("tiers", `Band ${i + 1}: enter a rate between 0 and 100`);
        }
        if (last) {
          tiers.push({ upto: null, rate: rateValue });
          break;
        }
        const upto = Number(row.upto);
        if (row.upto === "" || !Number.isFinite(upto) || upto <= lower) {
          return issue("tiers", `Band ${i + 1}: “up to” must be more than the band before it`);
        }
        tiers.push({ upto, rate: rateValue });
        lower = upto;
      }
    }
    return {
      employee_id: v.employee_id,
      name: v.name,
      period_start: v.period_start,
      period_end: v.period_end,
      target_amount: v.target_amount,
      method: v.method,
      rate,
      flat_amount,
      tiers,
    };
  });

/** A sale recorded against a target. The employee comes from the target, in the database. */
export const saleSchema = z.object({
  client_name: z.string().trim().min(2, "Enter the client's name"),
  description: optionalText,
  amount: money("Enter the sale amount"),
  sale_date: isoDate.refine((d) => d <= today(), "The sale date can't be in the future"),
  reference: optionalText,
});

export const rejectSchema = z.object({
  note: z.string().trim().min(3, "Say why you are rejecting it"),
});
