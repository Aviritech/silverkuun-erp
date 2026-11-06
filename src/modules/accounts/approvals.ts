import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentStaff } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import type { BranchRef } from "@/lib/org";

/*
 * The Accounts approvals queue: everything waiting for the signed-in accountant to approve, pay or post.
 * The database enforces each decision (permission, branch and "not your own request"); this only decides what to show.
 */

export type ApprovalKind = "approve_transaction" | "pay" | "approve_bill" | "post_journal";

export const APPROVAL_KINDS: Record<ApprovalKind, { label: string; verb: string }> = {
  approve_transaction: { label: "Receipts and payment requests to approve", verb: "Review" },
  pay: { label: "Payments approved by Internal Audit, ready to pay", verb: "Pay" },
  approve_bill: { label: "Supplier bills to approve", verb: "Review" },
  post_journal: { label: "Journals to post", verb: "Review" },
};

export type ApprovalItem = {
  kind: ApprovalKind;
  id: string;
  ref: string;
  title: string;
  detail: string;
  branch_id: string;
  amount: number | null;
  waitingSince: string | null;
  href: string;
};

type Txn = {
  id: string;
  txn_no: string;
  direction: "receipt" | "payment";
  branch_id: string;
  amount: string;
  counterparty: string | null;
  description: string;
  created_by: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  audited_at: string | null;
  needs_ops_confirmation: boolean;
  ops_confirmed_at: string | null;
  status: "submitted" | "approved";
  members: { first_name: string; last_name: string } | null;
  posting_rules: { name: string } | null;
};

export async function loadApprovals(supabase: SupabaseClient, staff: CurrentStaff, branches: BranchRef[]): Promise<ApprovalItem[]> {
  const branchOf = new Map(branches.map((b) => [b.id, b]));
  const holds = (permission: string, branchId: string) => {
    const b = branchOf.get(branchId);
    return Boolean(b && staff.permissions.hasForBranch(permission, b));
  };
  const canPay = (branchId: string) =>
    holds("accounts.payments.pay", branchId) ||
    (staff.permissions.has("accounts.payments.pay") && staff.permissions.has("accounts.payments.all_branches"));
  const mine = (...ids: (string | null)[]) => ids.includes(staff.id);

  const [txns, bills, journals] = await Promise.all([
    supabase
      .from("finance_transactions")
      .select(
        "id, txn_no, direction, branch_id, amount, counterparty, description, created_by, submitted_by, submitted_at, approved_at, audited_at, needs_ops_confirmation, ops_confirmed_at, status, members(first_name, last_name), posting_rules(name)",
      )
      .in("status", ["submitted", "approved"])
      .order("submitted_at")
      .limit(500),
    supabase
      .from("supplier_bills")
      .select("id, bill_no, branch_id, amount, supplier_reference, created_by, submitted_by, submitted_at, suppliers(name)")
      .eq("status", "submitted")
      .order("submitted_at")
      .limit(500),
    staff.permissions.has("accounts.journals.post")
      ? supabase.from("journal_entries").select("id, entry_no, branch_id, entry_date, description, created_by, created_at").eq("status", "draft").order("created_at").limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (txns.error) throw dbFailure(txns.error);
  if (bills.error) throw dbFailure(bills.error);
  if (journals.error) throw dbFailure(journals.error);

  const items: ApprovalItem[] = [];
  for (const t of txns.data as unknown as Txn[]) {
    const party = t.counterparty ?? (t.members ? `${t.members.first_name} ${t.members.last_name}` : "A member");
    const base = { id: t.id, ref: t.txn_no, title: party, branch_id: t.branch_id, amount: Number(t.amount), href: `/accounts/transactions/${t.id}` };
    const type = t.posting_rules?.name ?? (t.direction === "receipt" ? "Receipt" : "Payment");
    if (t.status === "submitted") {
      if (t.needs_ops_confirmation && !t.ops_confirmed_at) continue; // Operations checks it first.
      if (!holds("accounts.transactions.approve", t.branch_id) || mine(t.created_by, t.submitted_by)) continue;
      items.push({ ...base, kind: "approve_transaction", detail: type, waitingSince: t.submitted_at });
    } else if (t.direction === "payment" && t.audited_at && canPay(t.branch_id)) {
      items.push({ ...base, kind: "pay", detail: type, waitingSince: t.audited_at });
    }
  }
  type Bill = { id: string; bill_no: string; branch_id: string; amount: string; supplier_reference: string; created_by: string; submitted_by: string | null; submitted_at: string | null; suppliers: { name: string } | null };
  for (const b of bills.data as unknown as Bill[]) {
    if (!holds("accounts.transactions.approve", b.branch_id) || mine(b.created_by, b.submitted_by)) continue;
    items.push({
      kind: "approve_bill",
      id: b.id,
      ref: b.bill_no,
      title: b.suppliers?.name ?? "Supplier",
      detail: `Invoice ${b.supplier_reference}`,
      branch_id: b.branch_id,
      amount: Number(b.amount),
      waitingSince: b.submitted_at,
      href: `/accounts/bills/${b.id}`,
    });
  }
  type Journal = { id: string; entry_no: string; branch_id: string; description: string; created_by: string; created_at: string };
  for (const j of journals.data as Journal[]) {
    if (!holds("accounts.journals.post", j.branch_id) || mine(j.created_by)) continue;
    items.push({
      kind: "post_journal",
      id: j.id,
      ref: j.entry_no,
      title: j.description,
      detail: "Draft journal",
      branch_id: j.branch_id,
      amount: null,
      waitingSince: j.created_at,
      href: `/accounts/journals/${j.id}`,
    });
  }
  return items;
}
