import "server-only";
import { cache } from "react";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";

type Money = number;
type CountAmount = { count: number; amount: Money };

/** The figures End of Day, Month and Year save. Day reports also carry interest due and unfinished work. */
export type CloseReport = {
  from: string;
  to: string;
  ledger: { entries: number; debits: Money; credits: Money };
  trial_balance: { debits: Money; credits: Money };
  by_source: { source: string; entries: number; amount: Money }[];
  receipts: CountAmount;
  payments: CountAmount;
  cash: { opening: Money; money_in: Money; money_out: Money; closing: Money };
  profit_and_loss: { income: Money; expenses: Money; surplus: Money };
  position: { assets: Money; liabilities: Money; funds: Money; member_savings: Money; loans_outstanding: Money };
  by_branch: { branch: string; entries: number; debits: Money; money_in: Money; money_out: Money; surplus: Money }[];
  late_fees_from_savings: CountAmount;
  loans: { active: number; disbursed: number; outstanding_principal: Money; overdue: Money; par30: Money; penalty_outstanding: Money };
  interest_due?: { members: number; amount: Money };
  unfinished?: {
    transactions_draft: number;
    transactions_submitted: number;
    transactions_approved: number;
    journals_draft: number;
    pay_ins_to_post: number;
  };
  days_closed?: number;
};

export type BusinessDay = {
  business_date: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  close_mode: "manual" | "automatic" | null;
  note: string | null;
  report: CloseReport | null;
};

export type PeriodClose = {
  id: string;
  period_kind: "month" | "year";
  period_start: string;
  period_end: string;
  closed_at: string;
  closed_by: string | null;
  close_mode: "manual" | "automatic";
  report: CloseReport;
  closing_entry_ids: string[];
};

export type BusinessDateStatus = { business_date: string | null; last_closed: string | null; auto_close: boolean; auto_close_at: string };

/** The open business date, for every signed-in staff member. Null before the End of Day migration has run. */
export const getBusinessDateStatus = cache(async (): Promise<BusinessDateStatus | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("business_date_status");
  if (error) return null;
  return (data as BusinessDateStatus[])[0] ?? null;
});

export async function dayEndPreview(): Promise<CloseReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("day_end_preview");
  if (error) throw dbFailure(error);
  return data as CloseReport;
}

export async function listClosedDays(limit = 60): Promise<BusinessDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_days")
    .select("*")
    .eq("status", "closed")
    .order("business_date", { ascending: false })
    .limit(limit);
  if (error) throw dbFailure(error);
  return data as BusinessDay[];
}

export async function getBusinessDay(date: string): Promise<BusinessDay | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("business_days").select("*").eq("business_date", date).maybeSingle();
  if (error) throw dbFailure(error);
  return data as BusinessDay | null;
}

export async function listPeriodCloses(): Promise<PeriodClose[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("period_closes").select("*").order("period_end", { ascending: false }).order("period_kind");
  if (error) throw dbFailure(error);
  return data as PeriodClose[];
}

export async function getPeriodClose(id: string): Promise<PeriodClose | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("period_closes").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  return data as PeriodClose | null;
}

/** True when the date is the last day of its month. */
export function isMonthEnd(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() === 1;
}

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual journals",
  transaction: "Receipts and payments",
  reversal: "Reversals",
  bill: "Supplier bills",
  payroll: "Payroll",
  savings_recovery: "Late fees from savings",
  year_end: "Year-end closing",
};

export function periodName(kind: "month" | "year", end: string): string {
  if (kind === "year") return `Year ${end.slice(0, 4)}`;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${end}T00:00:00Z`));
}
