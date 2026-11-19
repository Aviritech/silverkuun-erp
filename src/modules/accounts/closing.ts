import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";

type Money = number;
type CountAmount = { count: number; amount: Money };

/** The figures End of Month and End of Year save. Month reports also carry the unfinished work. */
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
  unfinished?: {
    transactions_draft: number;
    transactions_submitted: number;
    transactions_approved: number;
    journals_draft: number;
    pay_ins_to_post: number;
  };
};

export type PeriodClose = {
  id: string;
  period_kind: "month" | "year";
  period_start: string;
  period_end: string;
  closed_at: string;
  closed_by: string;
  note: string | null;
  report: CloseReport;
  closing_entry_ids: string[];
};

export type NextMonth = { period_start: string; period_end: string; closed_through: string | null; has_ended: boolean };

export async function nextMonthToClose(): Promise<NextMonth> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("next_month_to_close");
  if (error) throw dbFailure(error);
  return (data as NextMonth[])[0];
}

export async function monthEndPreview(): Promise<CloseReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("month_end_preview");
  if (error) throw dbFailure(error);
  return data as CloseReport;
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
