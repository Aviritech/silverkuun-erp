import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type {
  BureauResult,
  CollateralType,
  CustomerCategory,
  InstallmentStatus,
  InterestMethod,
  LoanDocumentType,
  LoanStatus,
  RateBasis,
  ReminderChannel,
  RepaymentFrequency,
  RepaymentMode,
  RiskRating,
} from "./constants";

export type LoanProduct = {
  code: string;
  name: string;
  description: string;
  interest_rate: string;
  rate_basis: RateBasis;
  interest_method: InterestMethod;
  min_amount: string;
  max_amount: string | null;
  max_tenor_months: number;
  requires_guarantor: boolean;
  requires_collateral: boolean;
  requires_proforma: boolean;
  is_active: boolean;
  sort_order: number;
};

export type Loan = {
  id: string;
  loan_no: string;
  branch_id: string;
  member_id: string;
  product_code: string;
  status: LoanStatus;
  account_officer_id: string;
  phone: string;
  address: string;
  customer_category: CustomerCategory;
  employer_name: string | null;
  occupation: string | null;
  employer_address: string | null;
  monthly_income: string | null;
  amount_requested: string;
  purpose: string;
  tenor_months: number;
  repayment_frequency: RepaymentFrequency;
  interest_rate: string;
  rate_basis: RateBasis;
  interest_method: InterestMethod;
  repayment_mode: RepaymentMode;
  first_repayment_date: string | null;
  bureau_check: BureauResult | null;
  bureau_name: string | null;
  bureau_score: string | null;
  risk_rating: RiskRating | null;
  recommendation: "approve" | "decline" | null;
  recommended_amount: string | null;
  appraisal_notes: string | null;
  appraised_by: string | null;
  appraised_at: string | null;
  approved_amount: string | null;
  approval_note: string | null;
  decision_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  disbursement_txn_id: string | null;
  disbursement_txn_no: string | null;
  disbursement_status: string | null;
  disbursed_on: string | null;
  schedule_version: number;
  maturity_date: string | null;
  closed_on: string | null;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
};

/** A row of the loan_book view: the loan with its repayment position today. */
export type LoanBookRow = {
  id: string;
  loan_no: string;
  branch_id: string;
  region_id: string;
  member_id: string;
  member_name: string;
  membership_no: string | null;
  product_code: string;
  product_name: string;
  customer_category: CustomerCategory;
  account_officer_id: string;
  status: LoanStatus;
  amount_requested: string;
  approved_amount: string | null;
  tenor_months: number;
  repayment_frequency: RepaymentFrequency;
  interest_rate: string;
  rate_basis: RateBasis;
  interest_method: InterestMethod;
  risk_rating: RiskRating | null;
  created_at: string;
  submitted_at: string | null;
  appraised_at: string | null;
  approved_at: string | null;
  decided_at: string | null;
  disbursement_status: string | null;
  disbursed_on: string | null;
  maturity_date: string | null;
  closed_on: string | null;
  schedule_principal: string;
  schedule_interest: string;
  principal_repaid: string;
  interest_repaid: string;
  outstanding_principal: string;
  outstanding_interest: string;
  total_expected: string;
  overdue_amount: string;
  overdue_principal: string;
  missed_repayments: number;
  days_past_due: number;
  next_due_date: string | null;
  next_due_amount: string;
  remaining_installments: number;
  last_paid_on: string | null;
};

export type Installment = {
  id: string;
  loan_id: string;
  installment_no: number;
  due_date: string;
  principal_due: string;
  interest_due: string;
  principal_paid: string;
  interest_paid: string;
  outstanding: string;
  status: InstallmentStatus;
};

export type Guarantor = {
  id: string;
  full_name: string;
  phone: string;
  address: string;
  relationship: string | null;
  occupation: string | null;
  employer: string | null;
  monthly_income: string | null;
  is_member: boolean;
};

export type Collateral = {
  id: string;
  collateral_type: CollateralType;
  description: string;
  estimated_value: string;
  valuation_date: string | null;
  valued_by: string | null;
};

export type LoanDocument = {
  id: string;
  document_type: LoanDocumentType;
  file_name: string;
  storage_path: string;
  uploaded_by: string;
  uploaded_at: string;
};

export type Repayment = {
  id: string;
  finance_transaction_id: string;
  txn_no: string;
  paid_on: string;
  amount: string;
  principal: string;
  interest: string;
  schedule_version: number;
  reversed_at: string | null;
  reversal_reason: string | null;
};

export type Restructure = {
  id: string;
  loan_id: string;
  status: "pending" | "approved" | "rejected";
  tenor_months: number;
  repayment_frequency: RepaymentFrequency;
  interest_rate: string;
  rate_basis: RateBasis;
  interest_method: InterestMethod;
  first_repayment_date: string;
  reason: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  outstanding_principal: string | null;
  carried_interest: string | null;
};

export type Reminder = {
  id: string;
  loan_id: string;
  kind: "upcoming" | "overdue";
  channel: ReminderChannel;
  due_date: string | null;
  amount: string | null;
  note: string | null;
  sent_by: string;
  sent_at: string;
};

export type Officer = { id: string; full_name: string; branch_id: string | null; region_id: string | null };

async function rows<T>(promise: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw dbFailure(error);
  return data as T;
}

export async function listProducts(): Promise<LoanProduct[]> {
  const supabase = await createClient();
  return rows(supabase.from("loan_products").select("*").order("sort_order").order("name"));
}

/** Account officers, each with the branch or region they cover (org-wide officers have neither). */
export async function listOfficers(): Promise<Officer[]> {
  const supabase = await createClient();
  return rows(supabase.rpc("credit_officers"));
}

/** Officers who can hold a loan in the given branch. */
export function officersFor(officers: Officer[], branch: { id: string; region_id: string }): { id: string; full_name: string }[] {
  const seen = new Map<string, string>();
  for (const o of officers) {
    const covers = (o.branch_id === null && o.region_id === null) || o.branch_id === branch.id || o.region_id === branch.region_id;
    if (covers) seen.set(o.id, o.full_name);
  }
  return [...seen].map(([id, full_name]) => ({ id, full_name })).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function officerNames(): Promise<Map<string, string>> {
  return new Map((await listOfficers()).map((o) => [o.id, o.full_name]));
}

export async function loadLoanBook(): Promise<LoanBookRow[]> {
  const supabase = await createClient();
  return rows(supabase.from("loan_book").select("*").order("created_at", { ascending: false }).limit(5000));
}

export async function staffNameLookup(ids: (string | null | undefined)[]): Promise<(id: string | null | undefined) => string> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const supabase = await createClient();
  const { data } = unique.length ? await supabase.rpc("staff_display_names", { p_ids: unique }) : { data: [] };
  const names = new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
  return (id) => (id ? (names.get(id) ?? "Another staff member") : "—");
}

export async function getLoanBundle(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("loans").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  if (!data) return null;
  const loan = data as Loan;

  const [position, member, product, guarantors, collaterals, documents, schedule, repayments, restructures, reminders, history] =
    await Promise.all([
      rows<LoanBookRow[]>(supabase.from("loan_book").select("*").eq("id", id)),
      rows<{ id: string; first_name: string; middle_name: string | null; last_name: string; membership_no: string | null; phone: string; address: string }>(
        supabase.from("members").select("id, first_name, middle_name, last_name, membership_no, phone, address").eq("id", loan.member_id).single(),
      ),
      rows<LoanProduct>(supabase.from("loan_products").select("*").eq("code", loan.product_code).single()),
      rows<Guarantor[]>(supabase.from("loan_guarantors").select("*").eq("loan_id", id).order("created_at")),
      rows<Collateral[]>(supabase.from("loan_collaterals").select("*").eq("loan_id", id).order("created_at")),
      rows<LoanDocument[]>(supabase.from("loan_documents").select("*").eq("loan_id", id).order("uploaded_at")),
      rows<Installment[]>(supabase.from("loan_schedule_status").select("*").eq("loan_id", id).order("installment_no")),
      rows<Repayment[]>(supabase.from("loan_repayments").select("*").eq("loan_id", id).order("paid_on").order("posted_at")),
      rows<Restructure[]>(supabase.from("loan_restructures").select("*").eq("loan_id", id).order("requested_at")),
      rows<Reminder[]>(supabase.from("loan_reminders").select("*").eq("loan_id", id).order("sent_at", { ascending: false }).limit(20)),
      rows<{ id: string; loan_no: string; status: LoanStatus; approved_amount: string | null; amount_requested: string; created_at: string }[]>(
        supabase
          .from("loans")
          .select("id, loan_no, status, approved_amount, amount_requested, created_at")
          .eq("member_id", loan.member_id)
          .neq("id", id)
          .order("created_at", { ascending: false }),
      ),
    ]);

  const signed = documents.length
    ? await supabase.storage.from("loan-documents").createSignedUrls(documents.map((d) => d.storage_path), 120)
    : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const staffName = await staffNameLookup([
    loan.created_by,
    loan.submitted_by,
    loan.appraised_by,
    loan.approved_by,
    loan.decided_by,
    loan.account_officer_id,
    ...documents.map((d) => d.uploaded_by),
    ...restructures.flatMap((r) => [r.requested_by, r.decided_by]),
    ...reminders.map((r) => r.sent_by),
  ]);

  return {
    loan,
    position: position[0] ?? null,
    member,
    memberName: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(" "),
    product,
    guarantors,
    collaterals,
    documents: documents.map((d) => ({ ...d, url: urls.get(d.storage_path) ?? null })),
    schedule,
    repayments,
    restructures,
    reminders,
    otherLoans: history,
    staffName,
  };
}
