import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";
import { fetchAll } from "@/modules/credit/book";

/*
 * Headline figures for the Accounts dashboards. Everything is read through the signed-in accountant's own access,
 * so a branch accountant sees their branches and an organisation-wide role sees the whole Society.
 */

const n = (v: unknown) => Number(v ?? 0);

/** Member savings are the withdrawable and fixed-term savings payables. */
export const MEMBER_SAVINGS_ACCOUNTS = ["2110", "2120"] as const;
export const ROI_PAYABLE = "2140";

export type LedgerFigures = { cash: number; memberSavings: number; roiPayable: number };

type Balance = { code: string; cash_flow_class: string; account_type: string; closing: string };

/** Ledger balances at a date: cash and bank (debit balance), member savings and ROI payable (credit balances). */
export async function ledgerFigures(
  supabase: SupabaseClient,
  asAt: string,
  scope: { branch?: string | null; region?: string | null } = {},
): Promise<LedgerFigures> {
  const { data, error } = await supabase.rpc("account_balances", { p_from: asAt, p_to: asAt, p_branch_id: scope.branch ?? null, p_region_id: scope.region ?? null });
  if (error) throw dbFailure(error);
  const rows = data as Balance[];
  const sum = (pick: (b: Balance) => boolean, sign: number) => rows.filter(pick).reduce((s, b) => s + sign * n(b.closing), 0);
  return {
    cash: sum((b) => b.cash_flow_class === "cash" && b.account_type === "asset", 1),
    memberSavings: sum((b) => (MEMBER_SAVINGS_ACCOUNTS as readonly string[]).includes(b.code), -1),
    roiPayable: sum((b) => b.code === ROI_PAYABLE, -1),
  };
}

export type ActiveLoan = {
  id: string;
  loan_no: string;
  branch_id: string;
  region_id: string;
  member_id: string;
  member_name: string;
  membership_no: string | null;
  product_name: string;
  account_officer_id: string | null;
  outstanding_principal: string;
  outstanding_interest: string;
  overdue_amount: string;
  missed_repayments: number;
  days_past_due: number;
  next_due_date: string | null;
  next_due_amount: string;
  last_paid_on: string | null;
};

/** Every active (disbursed, not yet repaid) loan with its balances and arrears. */
export async function activeLoans(supabase: SupabaseClient): Promise<ActiveLoan[]> {
  return fetchAll<ActiveLoan>((from, to) =>
    supabase
      .from("loan_book")
      .select(
        "id, loan_no, branch_id, region_id, member_id, member_name, membership_no, product_name, account_officer_id, outstanding_principal, outstanding_interest, overdue_amount, missed_repayments, days_past_due, next_due_date, next_due_amount, last_paid_on",
      )
      .eq("status", "active")
      .order("loan_no")
      .range(from, to),
  );
}

/** Aging bands for member loan receivables, matching the demo the Society signed off on. */
export const RECEIVABLE_BANDS = [
  { key: "current", label: "Not yet due", short: "Current", min: 0, max: 0, tone: "good" },
  { key: "d1_30", label: "1–30 days overdue", short: "1–30 days", min: 1, max: 30, tone: "warn" },
  { key: "d31_60", label: "31–60 days overdue", short: "31–60 days", min: 31, max: 60, tone: "bad" },
  { key: "d60_plus", label: "Over 60 days overdue", short: "Over 60 days", min: 61, max: Infinity, tone: "bad" },
] as const;
export type ReceivableBand = (typeof RECEIVABLE_BANDS)[number]["key"];

export function receivableBand(daysPastDue: number) {
  return RECEIVABLE_BANDS.find((b) => daysPastDue >= b.min && daysPastDue <= b.max) ?? RECEIVABLE_BANDS[0];
}

/**
 * What a loan contributes to each band. A loan in arrears has its overdue amount in its arrears band and the rest of
 * its balance (principal and interest not yet due) under "Not yet due".
 */
export function loanAging(l: ActiveLoan): { band: ReceivableBand; overdue: number; notYetDue: number; total: number } {
  const total = n(l.outstanding_principal) + n(l.outstanding_interest);
  const overdue = l.days_past_due > 0 ? Math.min(n(l.overdue_amount), total) : 0;
  return { band: receivableBand(l.days_past_due).key, overdue, notYetDue: Math.max(0, total - overdue), total };
}

/** Posted money in and money out per calendar month, oldest first, for the last `months` months including this one. */
export async function monthlyMovement(supabase: SupabaseClient, months: number, today: string, branchIds: string[] | null = null) {
  const start = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));
  const from = start.toISOString().slice(0, 10);
  const rows = await fetchAll<{ direction: "receipt" | "payment"; amount: string; txn_date: string }>((a, b) => {
    let q = supabase.from("finance_transactions").select("direction, amount, txn_date").eq("status", "posted").gte("txn_date", from).lte("txn_date", today);
    if (branchIds) q = q.in("branch_id", branchIds);
    return q.order("id").range(a, b);
  });
  const buckets: { key: string; label: string; moneyIn: number; moneyOut: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    buckets.push({
      key: d.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(d),
      moneyIn: 0,
      moneyOut: 0,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const r of rows) {
    const b = byKey.get(r.txn_date.slice(0, 7));
    if (!b) continue;
    if (r.direction === "receipt") b.moneyIn += n(r.amount);
    else b.moneyOut += n(r.amount);
  }
  return buckets;
}

/** The last day of the month before the one `date` falls in. */
export function endOfPreviousMonth(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
