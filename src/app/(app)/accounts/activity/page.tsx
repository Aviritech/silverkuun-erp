import Link from "next/link";
import { ControlNote } from "@/components/dashboard";
import { Badge, Card, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts, staffNameLookup } from "@/modules/accounts/queries";

/*
 * Who entered, approved, paid, posted or reconciled what, built from the records' own timestamps.
 * Field-by-field history is in Internal Audit's audit trail, which only auditors can read.
 */

type Event = {
  at: string;
  who: string | null;
  what: string;
  ref: string;
  href: string;
  party: string;
  branch_id: string;
  amount: number | null;
  tone: "gray" | "amber" | "green" | "blue" | "red";
  tag: string;
};

const WINDOWS = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" } as const;

export default async function AccountsActivityPage({ searchParams }: { searchParams: Promise<{ days?: string; branch?: string }> }) {
  await requireModule(accountsModule);
  await requirePermission("accounts.read");
  const params = await searchParams;
  const days = params.days && params.days in WINDOWS ? params.days : "30";
  const since = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
  const supabase = await createClient();
  const recent = (cols: string[]) => cols.map((c) => `${c}.gte.${since}`).join(",");

  const [org, banks, txns, journals, imports, recs, bills] = await Promise.all([
    listOrg(),
    listBankAccounts(),
    supabase
      .from("finance_transactions")
      .select(
        "id, txn_no, direction, branch_id, amount, counterparty, created_by, created_at, submitted_by, submitted_at, ops_confirmed_by, ops_confirmed_at, approved_by, approved_at, audited_by, audited_at, paid_by, paid_at, posted_at, members(first_name, last_name), posting_rules(name)",
      )
      .or(recent(["created_at", "submitted_at", "ops_confirmed_at", "approved_at", "audited_at", "paid_at", "posted_at"]))
      .limit(1000),
    supabase.from("journal_entries").select("id, entry_no, branch_id, description, source, created_by, created_at, posted_by, posted_at").eq("source", "manual").or(recent(["created_at", "posted_at"])).limit(500),
    supabase.from("bank_statement_imports").select("id, bank_account_id, branch_id, file_name, line_count, imported_by, imported_at").gte("imported_at", since).limit(200),
    supabase.from("bank_reconciliations").select("id, bank_account_id, branch_id, period_end, difference, prepared_by, prepared_at, completed_by, completed_at").or(recent(["prepared_at", "completed_at"])).limit(200),
    supabase.from("supplier_bills").select("id, bill_no, branch_id, amount, created_by, created_at, approved_by, approved_at, suppliers(name)").or(recent(["created_at", "approved_at"])).limit(500),
  ]);
  for (const r of [txns, journals, imports, recs, bills]) if (r.error) throw dbFailure(r.error);

  const events: Event[] = [];
  const push = (e: Event) => {
    if (e.at >= since && (!params.branch || e.branch_id === params.branch)) events.push(e);
  };
  type T = {
    id: string; txn_no: string; direction: "receipt" | "payment"; branch_id: string; amount: string; counterparty: string | null; created_by: string;
    created_at: string; submitted_by: string | null; submitted_at: string | null; ops_confirmed_by: string | null; ops_confirmed_at: string | null;
    approved_by: string | null; approved_at: string | null; audited_by: string | null; audited_at: string | null; paid_by: string | null;
    paid_at: string | null; posted_at: string | null; members: { first_name: string; last_name: string } | null; posting_rules: { name: string } | null;
  };
  for (const t of txns.data as unknown as T[]) {
    const kind = t.direction === "receipt" ? "Receipt" : "Payment";
    const base = { ref: t.txn_no, href: `/accounts/transactions/${t.id}`, party: t.counterparty ?? (t.members ? `${t.members.first_name} ${t.members.last_name}` : "A member"), branch_id: t.branch_id, amount: Number(t.amount) };
    push({ ...base, at: t.created_at, who: t.created_by, what: `${kind} entered`, tone: "gray", tag: "Entered" });
    if (t.submitted_at) push({ ...base, at: t.submitted_at, who: t.submitted_by, what: `${kind} sent for approval`, tone: "amber", tag: "Submitted" });
    if (t.ops_confirmed_at) push({ ...base, at: t.ops_confirmed_at, who: t.ops_confirmed_by, what: "Operations checked the receipt", tone: "blue", tag: "Checked" });
    if (t.approved_at) push({ ...base, at: t.approved_at, who: t.approved_by, what: `${kind} approved`, tone: "blue", tag: "Approved" });
    if (t.audited_at) push({ ...base, at: t.audited_at, who: t.audited_by, what: "Internal Audit approved the payment", tone: "blue", tag: "Audit approved" });
    if (t.paid_at) push({ ...base, at: t.paid_at, who: t.paid_by, what: "Payment made", tone: "green", tag: "Paid" });
    if (t.posted_at) push({ ...base, at: t.posted_at, who: t.direction === "receipt" ? t.approved_by : t.paid_by, what: `${kind} posted to the ledger`, tone: "green", tag: "Posted" });
  }
  type J = { id: string; entry_no: string; branch_id: string; description: string; created_by: string; created_at: string; posted_by: string | null; posted_at: string | null };
  for (const j of journals.data as J[]) {
    const base = { ref: j.entry_no, href: `/accounts/journals/${j.id}`, party: j.description, branch_id: j.branch_id, amount: null };
    push({ ...base, at: j.created_at, who: j.created_by, what: "Journal prepared", tone: "gray", tag: "Draft" });
    if (j.posted_at) push({ ...base, at: j.posted_at, who: j.posted_by, what: "Journal posted", tone: "green", tag: "Posted" });
  }
  const bankName = new Map(banks.map((b) => [b.id, b.name]));
  type I = { id: string; bank_account_id: string; branch_id: string; file_name: string; line_count: number; imported_by: string; imported_at: string };
  for (const i of imports.data as I[]) {
    push({
      at: i.imported_at, who: i.imported_by, what: `Bank statement imported (${i.line_count} lines)`, ref: i.file_name, href: `/accounts/bank/${i.bank_account_id}`,
      party: bankName.get(i.bank_account_id) ?? "Bank account", branch_id: i.branch_id, amount: null, tone: "gray", tag: "Imported",
    });
  }
  type R = { id: string; bank_account_id: string; branch_id: string; period_end: string; difference: string; prepared_by: string; prepared_at: string; completed_by: string | null; completed_at: string | null };
  for (const r of recs.data as R[]) {
    const base = { ref: `To ${r.period_end}`, href: `/accounts/bank/${r.bank_account_id}`, party: bankName.get(r.bank_account_id) ?? "Bank account", branch_id: r.branch_id, amount: Number(r.difference) };
    push({ ...base, at: r.prepared_at, who: r.prepared_by, what: "Bank reconciliation prepared", tone: "amber", tag: "Prepared" });
    if (r.completed_at) push({ ...base, at: r.completed_at, who: r.completed_by, what: "Bank reconciliation completed", tone: "green", tag: "Reconciled" });
  }
  type B = { id: string; bill_no: string; branch_id: string; amount: string; created_by: string; created_at: string; approved_by: string | null; approved_at: string | null; suppliers: { name: string } | null };
  for (const b of bills.data as unknown as B[]) {
    const base = { ref: b.bill_no, href: `/accounts/bills/${b.id}`, party: b.suppliers?.name ?? "Supplier", branch_id: b.branch_id, amount: Number(b.amount) };
    push({ ...base, at: b.created_at, who: b.created_by, what: "Supplier bill recorded", tone: "gray", tag: "Entered" });
    if (b.approved_at) push({ ...base, at: b.approved_at, who: b.approved_by, what: "Supplier bill approved and posted", tone: "green", tag: "Posted" });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  const shown = events.slice(0, 200);
  const name = await staffNameLookup(shown.map((e) => e.who));
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Access & accountability"
        title="Activity"
        description="Who entered, approved, paid, posted or reconciled each record, newest first."
      />
      <Card
        title={`${WINDOWS[days as keyof typeof WINDOWS]}${events.length > shown.length ? ` · latest ${shown.length} of ${events.length}` : ""}`}
        actions={
          <form className="flex flex-wrap gap-2" role="search">
            <div className="w-36">
              <Select name="days" defaultValue={days} aria-label="Period">
                {Object.entries(WINDOWS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-40">
              <Select name="branch" defaultValue={params.branch ?? ""} aria-label="Branch">
                <option value="">All branches</option>
                {org.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
            <button type="submit" className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
              Show
            </button>
          </form>
        }
      >
        {shown.length === 0 ? (
          <EmptyState>No activity in this period.</EmptyState>
        ) : (
          <ul className="-my-2 divide-y divide-zinc-100">
            {shown.map((e, i) => (
              <li key={`${e.href}-${e.tag}-${i}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="text-ink">
                    {e.what}{" "}
                    <Link href={e.href} className="font-mono text-xs text-zinc-600 hover:underline">
                      {e.ref}
                    </Link>
                  </p>
                  <p className="text-xs text-zinc-500">
                    {e.party} · {branchName.get(e.branch_id)} · {formatDateTime(e.at)} · by {name(e.who)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {e.amount !== null && <span className="tabular-nums text-zinc-700">{formatMoney(e.amount)}</span>}
                  <Badge tone={e.tone}>{e.tag}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ControlNote>
        Posted entries are never edited in place: corrections are a reversal or adjustment with a reason and an approver. Internal Audit&apos;s
        audit trail keeps the before and after values of every change.
      </ControlNote>
    </div>
  );
}
