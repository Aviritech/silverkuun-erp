import "server-only";
import { notFound } from "next/navigation";
import { requireModule, type CurrentStaff } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { hrModule } from "../module";
import type { CommissionMethod, PayoutStatus, SaleStatus, TargetStatus, Tier } from "./constants";

export type CommissionTarget = {
  id: string;
  employee_id: string;
  name: string;
  period_start: string;
  period_end: string;
  target_amount: string;
  method: CommissionMethod;
  rate: string | null;
  flat_amount: string | null;
  tiers: Tier[] | null;
  status: TargetStatus;
  achieved: string | null;
  commission: string | null;
  payout_id: string | null;
  created_by: string;
  created_at: string;
  closed_by: string | null;
  closed_at: string | null;
};

export type CommissionSale = {
  id: string;
  target_id: string;
  employee_id: string;
  client_name: string;
  description: string | null;
  amount: string;
  sale_date: string;
  reference: string | null;
  status: SaleStatus;
  decision_note: string | null;
  recorded_by: string;
  recorded_at: string;
  decided_by: string | null;
  decided_at: string | null;
};

export type Payout = { id: string; status: PayoutStatus; amount: string; payable_from: string };

export type PayPerson = { id: string; full_name: string; employee_no: string; branch_id: string };

/** Approved and pending sales totals per target. */
export type Progress = { approved: number; pending: number };

/** Names, employee numbers and branches of the given employees, as far as the signed-in staff member may know them. */
export async function payPeople(ids: (string | null | undefined)[]): Promise<Map<string, PayPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pay_people", { p_employee_ids: unique });
  if (error) throw dbFailure(error);
  return new Map((data as PayPerson[]).map((p) => [p.id, p]));
}

export async function listTargets(filters: { status?: TargetStatus; employeeId?: string }): Promise<CommissionTarget[]> {
  const supabase = await createClient();
  let query = supabase.from("commission_targets").select("*").order("period_end", { ascending: false }).limit(500);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
  const { data, error } = await query;
  if (error) throw dbFailure(error);
  return data as CommissionTarget[];
}

/** Approved and pending totals for each target. Rejected sales don't count. */
export async function salesProgress(targetIds: string[]): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>(targetIds.map((id) => [id, { approved: 0, pending: 0 }]));
  if (!targetIds.length) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_sales")
    .select("target_id, amount, status")
    .in("target_id", targetIds)
    .in("status", ["approved", "pending"]);
  if (error) throw dbFailure(error);
  for (const s of data as { target_id: string; amount: string; status: SaleStatus }[]) {
    const p = out.get(s.target_id)!;
    if (s.status === "approved") p.approved += Number(s.amount);
    else p.pending += Number(s.amount);
  }
  return out;
}

export async function getTarget(id: string): Promise<{ target: CommissionTarget; sales: CommissionSale[]; payout: Payout | null } | null> {
  const supabase = await createClient();
  const { data: target, error } = await supabase.from("commission_targets").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  if (!target) return null;
  const [sales, payout] = await Promise.all([
    supabase.from("commission_sales").select("*").eq("target_id", id).order("sale_date").order("recorded_at"),
    target.payout_id
      ? supabase.from("commission_payouts").select("id, status, amount, payable_from").eq("id", target.payout_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (sales.error) throw dbFailure(sales.error);
  // Payouts are visible to payroll readers and the employee; HR officers without payroll.read just don't see the status.
  return { target: target as CommissionTarget, sales: sales.data as CommissionSale[], payout: (payout.data as Payout | null) ?? null };
}

/** Payout status for closed targets, where the signed-in staff member may see it. */
export async function payoutsFor(payoutIds: (string | null)[]): Promise<Map<string, Payout>> {
  const ids = payoutIds.filter((id): id is string => Boolean(id));
  if (!ids.length) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("commission_payouts").select("id, status, amount, payable_from").in("id", ids);
  if (error) throw dbFailure(error);
  return new Map((data as Payout[]).map((p) => [p.id, p]));
}

/** Current employees HR may set targets for: those in the branches where the staff member holds commission.manage. */
export async function targetCandidates(): Promise<{ id: string; full_name: string; employee_no: string; branch_id: string; staff_id: string | null }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name, employee_no, branch_id, staff_id")
    .in("status", ["probation", "active"])
    .order("first_name")
    .order("last_name");
  if (error) throw dbFailure(error);
  type Row = { id: string; first_name: string; last_name: string; employee_no: string; branch_id: string; staff_id: string | null };
  return (data as Row[]).map((e) => ({
    id: e.id,
    staff_id: e.staff_id,
    full_name: `${e.first_name} ${e.last_name}`,
    employee_no: e.employee_no,
    branch_id: e.branch_id,
  }));
}

const COMMISSION_READERS = ["hr.read", "commission.manage", "commission.approve", "payroll.read"];

/** HR, commission approvers (the Financial Controller) and payroll staff use the Commission pages. */
export async function requireCommissionAccess(): Promise<CurrentStaff> {
  const staff = await requireModule(hrModule);
  if (!COMMISSION_READERS.some((p) => staff.permissions.has(p))) notFound();
  return staff;
}
