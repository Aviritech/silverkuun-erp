import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { BillStatus, Direction, FinanceStatus } from "./constants";

export type BankAccount = {
  id: string;
  branch_id: string;
  name: string;
  kind: "bank" | "cash";
  bank_name: string | null;
  account_number: string | null;
  ledger_account_code: string;
  currency: string;
  import_mapping: Record<string, string>;
  is_active: boolean;
};

export type PostingRule = {
  transaction_type: string;
  name: string;
  direction: Direction;
  debit_account: string | null;
  credit_account: string | null;
  interest_account: string | null;
  requires_member: boolean;
  is_active: boolean;
  sort_order: number;
};

export type LedgerAccount = {
  code: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "income" | "expense";
  parent_code: string | null;
  is_group: boolean;
  is_active: boolean;
  cash_flow_class: string;
  description: string;
};

export type FinanceTransaction = {
  id: string;
  txn_no: string;
  branch_id: string;
  direction: Direction;
  transaction_type: string;
  status: FinanceStatus;
  txn_date: string;
  amount: string;
  interest_amount: string;
  bank_account_id: string;
  member_id: string | null;
  counterparty: string | null;
  reference: string | null;
  description: string;
  contribution_id: string | null;
  statement_line_id: string | null;
  decision_reason: string | null;
  journal_entry_id: string | null;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** The savings plan a member receipt was paid into. */
  member_plan_id: string | null;
  /** Savings and capital keyed in by Accounts: Operations checks them against the member's records before approval. */
  needs_ops_confirmation: boolean;
  ops_confirmed_by: string | null;
  ops_confirmed_at: string | null;
  ops_note: string | null;
  /** Internal Audit's approval of a payment, needed before it is paid. */
  audited_by: string | null;
  audited_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  posted_at: string | null;
  department_code: string | null;
  plan_type: string | null;
  staff_id: string | null;
  supplier_id: string | null;
  supplier_bill_id: string | null;
  loan_id: string | null;
  currency: string;
  foreign_amount: string | null;
  fx_rate: string | null;
};

export type JournalLine = {
  id: string;
  line_no: number;
  account_code: string;
  debit: string;
  credit: string;
  member_id: string | null;
  bank_account_id: string | null;
  description: string | null;
  department_code: string | null;
  plan_type: string | null;
  staff_id: string | null;
  supplier_id: string | null;
};

export type JournalEntry = {
  id: string;
  entry_no: string;
  branch_id: string;
  entry_date: string;
  description: string;
  source: "manual" | "transaction" | "reversal" | "bill" | "payroll";
  bill_id: string | null;
  transaction_id: string | null;
  status: "draft" | "posted";
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
  reversal_reason: string | null;
  created_by: string;
  created_at: string;
  posted_by: string | null;
  posted_at: string | null;
};

/** An active savings plan a receipt can be paid into. */
export type PlanOption = { id: string; label: string };
export type MemberOption = { id: string; name: string; membership_no: string | null; branch_id: string; plans: PlanOption[] };

async function rows<T>(promise: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw dbFailure(error);
  return data as T;
}

export async function listBankAccounts(): Promise<BankAccount[]> {
  const supabase = await createClient();
  return rows(supabase.from("bank_accounts").select("*").order("name"));
}

export async function listPostingRules(): Promise<PostingRule[]> {
  const supabase = await createClient();
  return rows(supabase.from("posting_rules").select("*").order("sort_order"));
}

export async function listLedgerAccounts(): Promise<LedgerAccount[]> {
  const supabase = await createClient();
  return rows(supabase.from("ledger_accounts").select("*").order("code"));
}

/** Approved members the signed-in staff member can see, for linking receipts and payments. */
/** A loan Accounts can pay out or take a repayment against. */
export type LoanOption = {
  id: string;
  loan_no: string;
  branch_id: string;
  member_id: string;
  member_name: string;
  status: "approved" | "active";
  approved_amount: string;
  outstanding: number;
  overdue: number;
};

/** Active loans (for repayments) and approved loans waiting to be paid out (for disbursements). */
export async function listLoanOptions(): Promise<LoanOption[]> {
  const supabase = await createClient();
  const data = await rows<
    { id: string; loan_no: string; branch_id: string; member_id: string; member_name: string; status: "approved" | "active"; approved_amount: string; outstanding_principal: string; outstanding_interest: string; overdue_amount: string }[]
  >(
    supabase
      .from("loan_book")
      .select("id, loan_no, branch_id, member_id, member_name, status, approved_amount, outstanding_principal, outstanding_interest, overdue_amount")
      .in("status", ["approved", "active"])
      .order("loan_no")
      .limit(1000),
  );
  return data.map((l) => ({
    ...l,
    outstanding: Number(l.outstanding_principal) + Number(l.outstanding_interest),
    overdue: Number(l.overdue_amount),
  }));
}

export async function listMemberOptions(): Promise<MemberOption[]> {
  const supabase = await createClient();
  const data = await rows<
    {
      id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      membership_no: string | null;
      branch_id: string;
      member_plans: { id: string; status: string; start_date: string; plan_types: { name: string } | null }[];
    }[]
  >(
    supabase
      .from("members")
      .select("id, first_name, middle_name, last_name, membership_no, branch_id, member_plans(id, status, start_date, plan_types(name))")
      .eq("status", "approved")
      .order("last_name")
      .limit(2000),
  );
  return data.map((m) => ({
    id: m.id,
    name: [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" "),
    membership_no: m.membership_no,
    branch_id: m.branch_id,
    plans: (m.member_plans ?? [])
      .filter((p) => p.status === "active")
      .map((p) => ({ id: p.id, label: `${p.plan_types?.name ?? "Plan"} from ${p.start_date}` })),
  }));
}

export async function staffNameLookup(ids: (string | null | undefined)[]): Promise<(id: string | null | undefined) => string> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const supabase = await createClient();
  const { data } = unique.length ? await supabase.rpc("staff_display_names", { p_ids: unique }) : { data: [] };
  const names = new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
  return (id) => (id ? (names.get(id) ?? "Another staff member") : "—");
}

export async function memberNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("id, first_name, last_name, membership_no").in("id", unique);
  return new Map((data ?? []).map((m) => [m.id, `${m.first_name} ${m.last_name}${m.membership_no ? ` (${m.membership_no})` : ""}`]));
}

export async function getTransactionBundle(id: string) {
  const supabase = await createClient();
  const { data: txn, error } = await supabase.from("finance_transactions").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  if (!txn) return null;
  const t = txn as FinanceTransaction;

  const [rule, bank, attachments, lines] = await Promise.all([
    rows<PostingRule>(supabase.from("posting_rules").select("*").eq("transaction_type", t.transaction_type).single()),
    rows<BankAccount>(supabase.from("bank_accounts").select("*").eq("id", t.bank_account_id).single()),
    rows<{ id: string; kind: "supporting" | "payment_proof"; file_name: string; storage_path: string; uploaded_by: string; uploaded_at: string }[]>(
      supabase.from("finance_attachments").select("*").eq("transaction_id", id).order("uploaded_at"),
    ),
    t.journal_entry_id
      ? rows<JournalLine[]>(supabase.from("journal_lines").select("*").eq("entry_id", t.journal_entry_id).order("line_no"))
      : Promise.resolve([] as JournalLine[]),
  ]);
  const signed = attachments.length
    ? await supabase.storage.from("finance-evidence").createSignedUrls(attachments.map((a) => a.storage_path), 120)
    : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const [staffName, members, tags] = await Promise.all([
    staffNameLookup([t.created_by, t.submitted_by, t.ops_confirmed_by, t.approved_by, t.audited_by, t.paid_by, t.staff_id, ...attachments.map((a) => a.uploaded_by)]),
    memberNames([t.member_id]),
    Promise.all([
      t.department_code ? supabase.from("departments").select("name").eq("code", t.department_code).maybeSingle() : null,
      t.plan_type ? supabase.from("plan_types").select("name").eq("code", t.plan_type).maybeSingle() : null,
      t.supplier_id ? supabase.from("suppliers").select("name").eq("id", t.supplier_id).maybeSingle() : null,
      t.supplier_bill_id ? supabase.from("supplier_bills").select("id, bill_no").eq("id", t.supplier_bill_id).maybeSingle() : null,
      t.member_plan_id
        ? supabase.from("member_plans").select("start_date, plan_types(name)").eq("id", t.member_plan_id).maybeSingle()
        : null,
    ]),
  ]);
  const [department, product, supplier, bill, plan] = tags.map((r) => r?.data ?? null) as [
    { name: string } | null,
    { name: string } | null,
    { name: string } | null,
    { id: string; bill_no: string } | null,
    { start_date: string; plan_types: { name: string } | null } | null,
  ];
  return {
    txn: t,
    department: department?.name ?? null,
    product: product?.name ?? null,
    supplier: supplier?.name ?? null,
    bill,
    plan: plan ? `${plan.plan_types?.name ?? "Plan"} from ${plan.start_date}` : null,
    rule,
    bank,
    attachments: attachments.map((a) => ({ ...a, url: urls.get(a.storage_path) ?? null })),
    lines,
    staffName,
    memberName: t.member_id ? (members.get(t.member_id) ?? "A member") : null,
  };
}

export async function getJournalBundle(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("journal_entries").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  if (!data) return null;
  const entry = data as JournalEntry;
  const [lines, accounts, related] = await Promise.all([
    rows<JournalLine[]>(supabase.from("journal_lines").select("*").eq("entry_id", id).order("line_no")),
    listLedgerAccounts(),
    rows<{ id: string; entry_no: string }[]>(
      supabase
        .from("journal_entries")
        .select("id, entry_no")
        .in("id", [entry.reverses_entry_id, entry.reversed_by_entry_id].filter((x): x is string => Boolean(x))),
    ),
  ]);
  const [staffName, members] = await Promise.all([
    staffNameLookup([entry.created_by, entry.posted_by]),
    memberNames(lines.map((l) => l.member_id)),
  ]);
  return {
    entry,
    lines,
    accountName: new Map(accounts.map((a) => [a.code, a.name])),
    entryNo: new Map(related.map((r) => [r.id, r.entry_no])),
    staffName,
    members,
  };
}

export type Supplier = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bank_name: string | null;
  account_number: string | null;
  tax_id: string | null;
  is_active: boolean;
};

export type SupplierBill = {
  id: string;
  bill_no: string;
  supplier_id: string;
  branch_id: string;
  department_code: string | null;
  bill_date: string;
  due_date: string;
  supplier_reference: string;
  expense_account: string;
  amount: string;
  description: string;
  status: BillStatus;
  decision_reason: string | null;
  journal_entry_id: string | null;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

/** An approved bill with what has been paid against it (posted supplier payments) and what is still owed. */
export type OpenBill = {
  id: string;
  bill_no: string;
  supplier_id: string;
  supplier_name: string;
  branch_id: string;
  bill_date: string;
  due_date: string;
  supplier_reference: string;
  amount: string;
  paid: string;
  outstanding: string;
};

export async function listSuppliers(): Promise<Supplier[]> {
  const supabase = await createClient();
  return rows(supabase.from("suppliers").select("*").order("name"));
}

/** Approved bills with money still owed, for paying them. */
export async function listOpenBills(): Promise<OpenBill[]> {
  const supabase = await createClient();
  return rows(
    supabase
      .from("supplier_bill_balances")
      .select("id, bill_no, supplier_id, supplier_name, branch_id, bill_date, due_date, supplier_reference, amount, paid, outstanding")
      .eq("status", "posted")
      .gt("outstanding", 0)
      .order("due_date"),
  );
}

export async function listStaffOptions(): Promise<{ id: string; full_name: string; department_code: string }[]> {
  const supabase = await createClient();
  return rows(supabase.rpc("staff_options"));
}

export async function getBillBundle(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("supplier_bills").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  if (!data) return null;
  const bill = data as SupplierBill;
  const [supplier, balance, attachments, payments, accounts] = await Promise.all([
    rows<Supplier>(supabase.from("suppliers").select("*").eq("id", bill.supplier_id).single()),
    rows<{ paid: string; outstanding: string }[]>(supabase.from("supplier_bill_balances").select("paid, outstanding").eq("id", id)),
    rows<{ id: string; file_name: string; storage_path: string; uploaded_by: string; uploaded_at: string }[]>(
      supabase.from("finance_attachments").select("*").eq("supplier_bill_id", id).order("uploaded_at"),
    ),
    rows<{ id: string; txn_no: string; txn_date: string; amount: string; status: FinanceStatus }[]>(
      supabase.from("finance_transactions").select("id, txn_no, txn_date, amount, status").eq("supplier_bill_id", id).order("txn_date"),
    ),
    listLedgerAccounts(),
  ]);
  const signed = attachments.length
    ? await supabase.storage.from("finance-evidence").createSignedUrls(attachments.map((a) => a.storage_path), 120)
    : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const staffName = await staffNameLookup([bill.created_by, bill.submitted_by, bill.approved_by, ...attachments.map((a) => a.uploaded_by)]);
  return {
    bill,
    supplier,
    paid: balance[0]?.paid ?? "0",
    outstanding: balance[0]?.outstanding ?? bill.amount,
    attachments: attachments.map((a) => ({ ...a, url: urls.get(a.storage_path) ?? null })),
    payments,
    accountName: new Map(accounts.map((a) => [a.code, a.name])),
    staffName,
  };
}

/** Choices for the reporting fields on a receipt or payment. */
export async function loadDimensionChoices() {
  const supabase = await createClient();
  const [departments, products, staff, suppliers, openBills] = await Promise.all([
    rows<{ code: string; name: string }[]>(supabase.from("departments").select("code, name").eq("is_active", true).order("name")),
    rows<{ code: string; name: string }[]>(supabase.from("plan_types").select("code, name").eq("is_active", true).order("sort_order")),
    listStaffOptions(),
    listSuppliers(),
    listOpenBills(),
  ]);
  return { departments, products, staff, suppliers, openBills };
}
