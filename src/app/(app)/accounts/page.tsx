import Link from "next/link";
import { AttentionPanel, MoneyChart, ProcessSteps, ProgressRing, StatCard, StatGrid, WorkQueues, firstName, greeting, workspaceEyebrow } from "@/components/dashboard";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { addDays, today as todayIso } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { loadApprovals } from "@/modules/accounts/approvals";
import { financeStatus, type FinanceStatus } from "@/modules/accounts/constants";
import { activeLoans, endOfPreviousMonth, ledgerFigures, monthlyMovement } from "@/modules/accounts/figures";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts, staffNameLookup } from "@/modules/accounts/queries";
import { listLiquidations } from "@/modules/administration/queries";

const STEPS = [
  { title: "Capture", text: "Member, amount, date and evidence" },
  { title: "Identify", text: "Linked to the savings plan, loan or supplier" },
  { title: "Classify", text: "The posting rule picks the accounts" },
  { title: "Approve", text: "Someone else approves; Internal Audit approves payments" },
  { title: "Post", text: "A balanced journal updates the ledger" },
  { title: "Reconcile", text: "Matched to the bank statement" },
];

export default async function AccountsPage() {
  const staff = await requireModule(accountsModule);
  const supabase = await createClient();
  const today = todayIso();
  const count = (q: PromiseLike<{ count: number | null; error: { code?: string; message: string } | null }>) =>
    Promise.resolve(q).then((r) => {
      if (r.error) throw dbFailure(r.error);
      return r.count ?? 0;
    });

  const org = await listOrg();
  // The branches this accountant's ledger figures cover (null: the whole Society).
  const scopeBranches = staff.permissions.isOrganisationWide("accounts.read")
    ? null
    : org.branches.filter((b) => staff.permissions.hasForBranch("accounts.read", b));
  const scopeIds = scopeBranches?.map((b) => b.id) ?? null;
  const [returned, awaitingPosting, toDisburse, liquidations, banks, balances, now, lastMonth, loans, movement, approvals, recent] = await Promise.all([
    count(supabase.from("finance_transactions").select("id", { count: "exact", head: true }).eq("status", "returned").eq("created_by", staff.id)),
    count(supabase.from("contributions_awaiting_posting").select("id", { count: "exact", head: true })),
    count(supabase.from("loans_awaiting_disbursement").select("id", { count: "exact", head: true })),
    listLiquidations(["approved"]).then((list) => list.filter((l) => l.payment_status === null || ["rejected", "reversed"].includes(l.payment_status)).length),
    listBankAccounts(),
    supabase.from("bank_account_balances").select("bank_account_id, ledger_balance, unmatched_lines"),
    ledgerFigures(supabase, today),
    ledgerFigures(supabase, endOfPreviousMonth(today)),
    activeLoans(supabase),
    monthlyMovement(supabase, 6, today, scopeIds),
    loadApprovals(supabase, staff, org.branches),
    supabase
      .from("finance_transactions")
      .select(
        "id, txn_no, txn_date, direction, status, audited_at, needs_ops_confirmation, ops_confirmed_at, amount, counterparty, branch_id, created_by, members(first_name, last_name), posting_rules(name)",
      )
      .order("created_at", { ascending: false })
      .limit(6),
  ]);
  if (balances.error) throw dbFailure(balances.error);
  if (recent.error) throw dbFailure(recent.error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));

  // Scope line: which branches this accountant's figures cover.
  const scope = scopeBranches === null ? "all branches" : scopeBranches.map((b) => b.name).join(", ") || "your branches";

  const cashChange = lastMonth.cash ? ((now.cash - lastMonth.cash) / Math.abs(lastMonth.cash)) * 100 : null;
  const principal = loans.reduce((s, l) => s + Number(l.outstanding_principal), 0);
  const weekEnd = addDays(today, 7);
  const dueThisWeek = loans.filter((l) => l.next_due_date && l.next_due_date <= weekEnd).length;
  const inArrears = loans.filter((l) => l.days_past_due > 0).length;

  // The bank account with the most unmatched lines is the one to show on the reconciliation card.
  type Bal = { bank_account_id: string; ledger_balance: string; unmatched_lines: number };
  const bankRows = (balances.data as Bal[]).filter((b) => {
    const bank = banks.find((x) => x.id === b.bank_account_id);
    return bank?.kind === "bank" && (!scopeIds || scopeIds.includes(bank.branch_id));
  });
  const focus = [...bankRows].sort((a, b) => b.unmatched_lines - a.unmatched_lines)[0];
  const focusBank = focus ? banks.find((b) => b.id === focus.bank_account_id) : undefined;
  const focusTotal = focus
    ? await count(supabase.from("bank_statement_lines").select("id", { count: "exact", head: true }).eq("bank_account_id", focus.bank_account_id))
    : 0;
  const matchedPct = focusTotal ? ((focusTotal - focus!.unmatched_lines) / focusTotal) * 100 : 100;

  type Recent = {
    id: string; txn_no: string; txn_date: string; direction: "receipt" | "payment"; status: FinanceStatus; audited_at: string | null;
    needs_ops_confirmation: boolean; ops_confirmed_at: string | null; amount: string; counterparty: string | null; branch_id: string;
    created_by: string; members: { first_name: string; last_name: string } | null; posting_rules: { name: string } | null;
  };
  const recentRows = recent.data as unknown as Recent[];
  const staffName = await staffNameLookup(recentRows.map((r) => r.created_by));

  const queues = [
    { label: "Savings pay-ins to post", value: awaitingPosting, href: "/accounts/contributions", show: staff.permissions.has("accounts.receipts.record") },
    { label: "Loans to pay out", value: toDisburse, href: "/accounts/loans", show: staff.permissions.has("accounts.payments.request") },
    { label: "Liquidations to pay", value: liquidations, href: "/accounts/liquidations", show: staff.permissions.has("accounts.payments.request") },
    { label: "Returned to you", value: returned, href: "/accounts/transactions?status=returned", show: true },
    { label: "Loans in arrears", value: inArrears, href: "/accounts/receivables", show: true },
  ].filter((q) => q.show);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow={workspaceEyebrow("Accounts")}
        title={`${greeting()}, ${firstName(staff.fullName)}`}
        description={`Figures cover ${scope}.`}
        actions={
          <>
            <ButtonLink href="/accounts/bank" variant="secondary">
              Import bank statement
            </ButtonLink>
            {staff.permissions.has("accounts.payments.request") && (
              <ButtonLink href="/accounts/transactions/new?direction=payment" variant="secondary">
                Request payment
              </ButtonLink>
            )}
            {staff.permissions.has("accounts.receipts.record") && <ButtonLink href="/accounts/transactions/new?direction=receipt">Record receipt</ButtonLink>}
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Cash & bank"
          icon="bank"
          value={formatMoneyShort(now.cash)}
          href="/accounts/bank"
          hint={
            cashChange === null ? (
              "Ledger balance today"
            ) : (
              <>
                <span className={cashChange >= 0 ? "font-medium text-emerald-700" : "font-medium text-red-700"}>
                  {cashChange >= 0 ? "↑" : "↓"} {Math.abs(cashChange).toFixed(1)}%
                </span>{" "}
                from the end of last month
              </>
            )
          }
        />
        <StatCard label="Member savings" icon="savings" value={formatMoneyShort(now.memberSavings)} hint="Savings and fixed-term payables (2110, 2120)" href="/accounts/reports/member-balances" />
        <StatCard
          label="Loans outstanding"
          icon="loan"
          value={formatMoneyShort(principal)}
          hint={`${loans.length} active loans · ${dueThisWeek} repayments due this week`}
          href="/accounts/receivables"
        />
        <StatCard label="ROI owed to members" icon="clock" value={formatMoneyShort(now.roiPayable)} hint="ROI payable (2140) after accruals" href="/accounts/roi-accrual" />
      </StatGrid>

      <WorkQueues queues={queues} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Money movement" actions={<span className="text-xs text-zinc-500">Posted receipts and payments, last 6 months</span>}>
            <MoneyChart points={movement} format={formatMoneyShort} />
          </Card>
        </div>
        <div className="space-y-6">
          <AttentionPanel count={approvals.length} title={approvals.length ? "Items waiting for you" : "Nothing waiting for you"} href="/accounts/approvals" cta="Open approvals">
            {approvals.length
              ? "Approve, pay or post them. Nobody approves their own request."
              : "When someone sends you a request to approve, pay or post, it appears here."}
          </AttentionPanel>
          <Card title="Bank reconciliation" actions={<Link href="/accounts/bank" className="text-xs font-medium text-brand-700 underline">Open</Link>}>
            {focusBank && focus && focusTotal > 0 ? (
              <Link href={`/accounts/bank/${focusBank.id}`} className="flex items-center gap-4">
                <ProgressRing percent={matchedPct} />
                <div className="text-sm">
                  <p className="font-medium text-ink">{focusBank.name}</p>
                  <p className="text-zinc-600">
                    {focusTotal - focus.unmatched_lines} of {focusTotal} statement lines matched
                  </p>
                  {focus.unmatched_lines > 0 && <p className="text-amber-700">{focus.unmatched_lines} lines need review</p>}
                </div>
              </Link>
            ) : (
              <p className="text-sm text-zinc-600">No bank statements imported yet.</p>
            )}
          </Card>
        </div>
      </div>

      <Card title="Recent activity" actions={<Link href="/accounts/transactions" className="text-xs font-medium text-brand-700 underline">All receipts and payments</Link>}>
        {recentRows.length === 0 ? (
          <EmptyState>No receipts or payments yet.</EmptyState>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Transaction</th>
                  <th className="px-5 py-2.5 font-medium">Member / beneficiary</th>
                  <th className="px-5 py-2.5 font-medium">Branch</th>
                  <th className="px-5 py-2.5 font-medium">Prepared by</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((t) => {
                  const st = financeStatus(t);
                  return (
                    <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                      <td className="px-5 py-2.5">
                        <Link href={`/accounts/transactions/${t.id}`} className="font-medium hover:underline">
                          {t.posting_rules?.name ?? (t.direction === "receipt" ? "Receipt" : "Payment")}
                        </Link>
                        <span className="block text-xs text-zinc-500">
                          {formatDate(t.txn_date)} · {t.txn_no}
                        </span>
                      </td>
                      <td className="px-5 py-2.5">{t.counterparty ?? (t.members ? `${t.members.first_name} ${t.members.last_name}` : "A member")}</td>
                      <td className="px-5 py-2.5">{branchName.get(t.branch_id)}</td>
                      <td className="px-5 py-2.5">{staffName(t.created_by)}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className={`px-5 py-2.5 text-right tabular-nums ${t.direction === "receipt" ? "text-emerald-700" : ""}`}>
                        {t.direction === "receipt" ? "+" : "−"}
                        {formatMoney(t.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ProcessSteps title="How a transaction moves through the ERP" note="Every step is in the audit trail" steps={STEPS} />
    </div>
  );
}
