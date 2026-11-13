import "server-only";
import type { PermissionSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES, type DocumentType, type LiquidationStatus, type MemberStatus } from "./constants";
import { dbFailure } from "@/lib/db-errors";
import { signaturesFor, signatureStaffIds } from "@/modules/signatures/queries";

export type Branch = { id: string; code: string; name: string; region_id: string };

export type Member = {
  id: string;
  branch_id: string;
  membership_no: string | null;
  status: MemberStatus;
  title: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  gender: "female" | "male" | null;
  phone: string;
  email: string | null;
  address: string;
  nin: string;
  id_type: string;
  id_number: string;
  next_of_kin_name: string | null;
  next_of_kin_phone: string | null;
  next_of_kin_relationship: string | null;
  /** Where monthly interest is paid. bank_code is null for a bank without a CBN code. */
  bank_code: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  /** Day of the month interest is paid; the last day in shorter months. */
  interest_pay_day: number | null;
  return_reason: string | null;
  returned_by: string | null;
  sent_to_marketer_by: string | null;
  sent_to_marketer_at: string | null;
  /** The marketer who reviewed the file, with their note. */
  marketer_id: string | null;
  marketer_reviewed_at: string | null;
  marketer_note: string | null;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** PNG data URL drawn by the Branch Manager on approval. */
  approval_signature: string | null;
};

export type CbnBank = { code: string; name: string };

export async function listCbnBanks(): Promise<CbnBank[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cbn_banks").select("code, name").order("name");
  if (error) throw dbFailure(error);
  return data as CbnBank[];
}

export type MemberDocument = {
  id: string;
  document_type: DocumentType;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  issued_on: string | null;
  issued_by: string | null;
  issue_channel: string | null;
  issue_note: string | null;
};

export type Plan = {
  id: string;
  plan_type: string;
  contribution_amount: string;
  contribution_frequency: string;
  start_date: string;
  maturity_date: string;
  status: string;
  /** Annual interest rate (%), fixed from the plan type when the plan was opened. */
  interest_rate: string;
  /** True when dividends build up and are paid with the principal at maturity (Target savings), not monthly. */
  dividends_at_maturity: boolean;
};

/** A plan type members can open, with the rules the database enforces on new plans. */
export type PlanType = {
  code: string;
  name: string;
  /** Allowed tenures in months; null means any maturity date. */
  tenure_months: number[] | null;
  /** Smallest plan amount in naira; null means no minimum. */
  min_amount: string | null;
  dividends_at_maturity: boolean;
};

export type PlanTotals = {
  member_plan_id: string;
  total_contributed: string;
  total_verified: string;
  total_top_ups: string;
  unverified_count: number;
  last_paid_on: string | null;
};

/** Expected contributions to date against what was paid, from the plan_progress view. */
export type PlanProgress = {
  plan_id: string;
  installments_due: number;
  expected_to_date: string;
  scheduled_paid: string;
  outstanding: string;
  last_paid_on: string | null;
  days_to_maturity: number;
};

export type Contribution = {
  id: string;
  member_plan_id: string;
  kind: "scheduled" | "top_up" | "reversal";
  amount: string;
  paid_on: string;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  reverses_id: string | null;
  recorded_by: string;
  recorded_at: string;
  verified_by: string | null;
  verified_at: string | null;
};

export function fullName(m: Pick<Member, "title" | "first_name" | "middle_name" | "last_name">): string {
  return [m.title, m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ");
}

export async function listBranches(): Promise<Branch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("branches").select("id, code, name, region_id").eq("is_active", true).order("name");
  if (error) throw dbFailure(error);
  return data;
}

/** Branches where the staff member holds `permission`. */
export async function branchesWith(permissions: PermissionSet, permission: string): Promise<Branch[]> {
  return (await listBranches()).filter((b) => permissions.hasForBranch(permission, b));
}

export async function getMemberBundle(memberId: string) {
  const supabase = await createClient();
  const { data: member, error } = await supabase.from("members").select("*").eq("id", memberId).maybeSingle();
  if (error) throw dbFailure(error);
  if (!member) return null;

  const [documents, plans, totals, contributions, plansCatalog, progress] = await Promise.all([
    supabase.from("member_documents").select("*").eq("member_id", memberId).order("uploaded_at"),
    supabase.from("member_plans").select("*").eq("member_id", memberId).order("start_date"),
    supabase.from("member_plan_totals").select("*").eq("member_id", memberId),
    supabase.from("contributions").select("*").eq("member_id", memberId).order("paid_on").order("recorded_at"),
    supabase
      .from("plan_types")
      .select("code, name, tenure_months, min_amount, dividends_at_maturity")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("plan_progress")
      .select("plan_id, installments_due, expected_to_date, scheduled_paid, outstanding, last_paid_on, days_to_maturity")
      .eq("member_id", memberId),
  ]);
  for (const r of [documents, plans, totals, contributions, plansCatalog, progress]) if (r.error) throw dbFailure(r.error);

  // Dividends built up so far on plans that pay them at maturity, to show what the member will get at the end.
  const atMaturity = ((plans.data ?? []) as Plan[]).filter((p) => p.dividends_at_maturity);
  const accrued = await Promise.all(
    atMaturity.map((p) => supabase.rpc("plan_accrued_dividends", { p_plan_id: p.id })),
  );
  for (const r of accrued) if (r.error) throw dbFailure(r.error);

  const docs = (documents.data ?? []) as MemberDocument[];
  const signed = docs.length
    ? await supabase.storage.from("member-documents").createSignedUrls(docs.map((d) => d.storage_path), 120)
    : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const documentSignatures = await signaturesFor("member_document_id", docs.map((d) => d.id));

  const staffIds = [
    ...new Set(
      [
        member.created_by,
        member.sent_to_marketer_by,
        member.marketer_id,
        member.submitted_by,
        member.approved_by,
        member.returned_by,
        ...docs.map((d) => d.issued_by),
        ...signatureStaffIds(documentSignatures),
      ].filter(Boolean),
    ),
  ];
  const { data: staff } = staffIds.length
    ? await supabase.rpc("staff_display_names", { p_ids: staffIds })
    : { data: [] };
  const staffNames = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id as string, s.full_name as string]));

  return {
    member: member as Member,
    documents: docs.map((d) => ({ ...d, url: urls.get(d.storage_path) ?? null })),
    documentSignatures,
    plans: (plans.data ?? []) as Plan[],
    totals: new Map(((totals.data ?? []) as PlanTotals[]).map((t) => [t.member_plan_id, t])),
    progress: new Map(((progress.data ?? []) as PlanProgress[]).map((p) => [p.plan_id, p])),
    contributions: (contributions.data ?? []) as Contribution[],
    accruedDividends: new Map(atMaturity.map((p, i) => [p.id, String(accrued[i].data ?? 0)])),
    planTypes: (plansCatalog.data ?? []) as PlanType[],
    staffName: (id: string | null) => (id ? (staffNames.get(id) ?? "Another staff member") : "—"),
  };
}

export async function memberCounts(): Promise<Record<MemberStatus, number>> {
  const supabase = await createClient();
  const statuses = Object.keys(MEMBER_STATUSES) as MemberStatus[];
  const results = await Promise.all(
    statuses.map((s) => supabase.from("members").select("id", { count: "exact", head: true }).eq("status", s)),
  );
  for (const r of results) if (r.error) throw dbFailure(r.error);
  return Object.fromEntries(statuses.map((s, i) => [s, results[i].count ?? 0])) as Record<MemberStatus, number>;
}

export type Liquidation = {
  id: string;
  liquidation_no: string;
  branch_id: string;
  branch_name: string;
  status: LiquidationStatus;
  amount: string;
  plan_savings: string;
  member_id: string;
  member_name: string;
  membership_no: string | null;
  member_plan_id: string;
  plan_name: string;
  start_date: string;
  maturity_date: string;
  beneficiary_account_name: string;
  bank_code: string | null;
  bank_name: string;
  bank_account_no: string;
  note: string | null;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  payment_txn_id: string | null;
  payment_txn_no: string | null;
  payment_status: string | null;
  paid_at: string | null;
};

/** Liquidation requests in the caller's branches, newest first, with names (Operations and Accounts both use it). */
export async function listLiquidations(statuses?: string[]): Promise<Liquidation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("liquidation_requests", { p_status: statuses ?? null });
  if (error) throw dbFailure(error);
  return data as Liquidation[];
}

/** A receipt or payment Accounts recorded for a member (from member_money_history; needs members.full_view). */
export type MemberMoneyRow = {
  id: string;
  txn_no: string;
  direction: "receipt" | "payment";
  transaction_type: string;
  type_name: string;
  status: "draft" | "submitted" | "returned" | "rejected" | "approved" | "posted" | "reversed";
  txn_date: string;
  amount: string;
  interest_amount: string;
  reference: string | null;
  description: string;
  member_plan_id: string | null;
  plan_name: string | null;
  loan_id: string | null;
  loan_no: string | null;
  liquidation_id: string | null;
  liquidation_no: string | null;
  paid_at: string | null;
  posted_at: string | null;
};

export async function getMemberMoney(memberId: string): Promise<MemberMoneyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("member_money_history", { p_member_id: memberId });
  if (error) throw dbFailure(error);
  return (data ?? []) as MemberMoneyRow[];
}

/** One change to the member's records, newest first (from member_history; needs members.full_view). */
export type MemberHistoryRow = {
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  record_type: string;
  record_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  changed_fields: string[] | null;
  status: string | null;
  detail: string | null;
};

export async function getMemberHistory(memberId: string): Promise<MemberHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("member_history", { p_member_id: memberId });
  if (error) throw dbFailure(error);
  return (data ?? []) as MemberHistoryRow[];
}
