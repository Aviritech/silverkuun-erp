import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { Direction, FinanceStatus } from "./constants";

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
  paid_by: string | null;
  paid_at: string | null;
  posted_at: string | null;
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
};

export type JournalEntry = {
  id: string;
  entry_no: string;
  branch_id: string;
  entry_date: string;
  description: string;
  source: "manual" | "transaction" | "reversal";
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

export type MemberOption = { id: string; name: string; membership_no: string | null; branch_id: string };

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
export async function listMemberOptions(): Promise<MemberOption[]> {
  const supabase = await createClient();
  const data = await rows<{ id: string; first_name: string; middle_name: string | null; last_name: string; membership_no: string | null; branch_id: string }[]>(
    supabase
      .from("members")
      .select("id, first_name, middle_name, last_name, membership_no, branch_id")
      .eq("status", "approved")
      .order("last_name")
      .limit(2000),
  );
  return data.map((m) => ({
    id: m.id,
    name: [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" "),
    membership_no: m.membership_no,
    branch_id: m.branch_id,
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
  const [staffName, members] = await Promise.all([
    staffNameLookup([t.created_by, t.submitted_by, t.approved_by, t.paid_by, ...attachments.map((a) => a.uploaded_by)]),
    memberNames([t.member_id]),
  ]);
  return {
    txn: t,
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
