import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";
import type { ReportOption } from "@/lib/reports/types";
import { CUSTOMER_CATEGORIES, arrearsBucket } from "./constants";
import type { LoanBookRow } from "./queries";

/** The filters shared by the Credit dashboard and reports. Empty strings mean "all". */
export type BookFilters = {
  branch: string | null;
  region: string | null;
  officer?: string;
  product?: string;
  category?: string;
};

const PAGE = 1000;
const UUID = /^[0-9a-f-]{36}$/i;
const CODE = /^[a-z][a-z0-9_]{0,40}$/;

/** Reads every page of a query; PostgREST returns at most 1000 rows at a time. */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw dbFailure(error);
    const rows = data as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** The loan book, narrowed by branch, region, account officer, product and customer category. */
export async function loadBook(supabase: SupabaseClient, f: BookFilters): Promise<LoanBookRow[]> {
  return fetchAll<LoanBookRow>((from, to) => {
    let q = supabase.from("loan_book").select("*").order("loan_no").range(from, to);
    if (f.branch) q = q.eq("branch_id", f.branch);
    if (f.region) q = q.eq("region_id", f.region);
    if (f.officer && UUID.test(f.officer)) q = q.eq("account_officer_id", f.officer);
    if (f.product && CODE.test(f.product)) q = q.eq("product_code", f.product);
    if (f.category && f.category in CUSTOMER_CATEGORIES) q = q.eq("customer_category", f.category);
    return q;
  });
}

export async function loadOfficerNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("credit_officers");
  if (error) throw dbFailure(error);
  return new Map((data as { id: string; full_name: string }[]).map((o) => [o.id, o.full_name]));
}

/** Account officer, loan product and customer category choices for report filters. */
export async function bookFilterOptions(supabase: SupabaseClient): Promise<ReportOption[]> {
  const [officers, products] = await Promise.all([
    loadOfficerNames(supabase),
    supabase.from("loan_products").select("code, name").order("sort_order"),
  ]);
  if (products.error) throw dbFailure(products.error);
  return [
    {
      name: "officer",
      label: "Account officer",
      choices: [{ value: "", label: "All officers" }, ...[...officers].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))],
    },
    {
      name: "loan_product",
      label: "Loan product",
      choices: [{ value: "", label: "All products" }, ...(products.data as { code: string; name: string }[]).map((p) => ({ value: p.code, label: p.name }))],
    },
    {
      name: "category",
      label: "Customer category",
      choices: [{ value: "", label: "All customers" }, ...Object.entries(CUSTOMER_CATEGORIES).map(([value, label]) => ({ value, label }))],
    },
  ];
}

export const n = (v: unknown) => Number(v ?? 0);
export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Loans on the book today: paid out and not yet fully repaid. */
export const isOnBook = (l: LoanBookRow) => l.status === "active";
export const isDisbursed = (l: LoanBookRow) => l.status === "active" || l.status === "closed";
export const PENDING_STATUSES = ["draft", "submitted", "appraised", "returned"] as const;
export const isPending = (l: LoanBookRow) => (PENDING_STATUSES as readonly string[]).includes(l.status);
export const wasApproved = (l: LoanBookRow) => ["approved", "active", "closed"].includes(l.status);
export const outstanding = (l: LoanBookRow) => n(l.outstanding_principal) + n(l.outstanding_interest);

/** Portfolio figures for a set of loans: what is owed, what is late, and the suggested provision. */
export function portfolio(loans: LoanBookRow[]) {
  const live = loans.filter(isOnBook);
  const principal = live.reduce((s, l) => s + n(l.outstanding_principal), 0);
  const interest = live.reduce((s, l) => s + n(l.outstanding_interest), 0);
  const overdue = live.reduce((s, l) => s + n(l.overdue_amount), 0);
  const par = (days: number) => live.filter((l) => l.days_past_due > days).reduce((s, l) => s + n(l.outstanding_principal), 0);
  const provision = live.reduce((s, l) => s + n(l.outstanding_principal) * arrearsBucket(l.days_past_due).provision, 0);
  return {
    loans: live.length,
    customers: new Set(live.map((l) => l.member_id)).size,
    principal: round2(principal),
    interest: round2(interest),
    overdue: round2(overdue),
    overdueLoans: live.filter((l) => l.days_past_due > 0).length,
    par1: round2(par(0)),
    par30: round2(par(30)),
    par90: round2(par(90)),
    provision: round2(provision),
  };
}

export function pct(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}

export const inPeriod = (date: string | null, from: string, to: string) => Boolean(date) && date!.slice(0, 10) >= from && date!.slice(0, 10) <= to;
