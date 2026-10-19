import Link from "next/link";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { startOfYear, today } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts } from "@/modules/accounts/queries";

export default async function AccountsPage() {
  const staff = await requireModule(accountsModule);
  const supabase = await createClient();
  const count = (q: PromiseLike<{ count: number | null; error: { code?: string; message: string } | null }>) =>
    Promise.resolve(q).then((r) => {
      if (r.error) throw dbFailure(r.error);
      return r.count ?? 0;
    });

  const [toApprove, toPay, returned, draftJournals, awaitingPosting, unmatched, banks, balances, totals, org] = await Promise.all([
    count(supabase.from("finance_transactions").select("id", { count: "exact", head: true }).eq("status", "submitted")),
    count(supabase.from("finance_transactions").select("id", { count: "exact", head: true }).eq("status", "approved")),
    count(supabase.from("finance_transactions").select("id", { count: "exact", head: true }).eq("status", "returned").eq("created_by", staff.id)),
    count(supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("status", "draft")),
    count(supabase.from("contributions_awaiting_posting").select("id", { count: "exact", head: true })),
    count(supabase.from("bank_statement_lines").select("id", { count: "exact", head: true }).eq("status", "unmatched")),
    listBankAccounts(),
    supabase.from("bank_account_balances").select("bank_account_id, ledger_balance"),
    supabase.rpc("account_balances", { p_from: startOfYear(), p_to: today() }),
    listOrg(),
  ]);
  if (balances.error) throw dbFailure(balances.error);
  if (totals.error) throw dbFailure(totals.error);
  const balanceOf = new Map((balances.data ?? []).map((b) => [b.bank_account_id, Number(b.ledger_balance)]));
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  type B = { account_type: string; debit: string; credit: string };
  const ytd = (type: string, sign: number) =>
    (totals.data as B[]).filter((b) => b.account_type === type).reduce((s, b) => s + sign * (Number(b.debit) - Number(b.credit)), 0);
  const income = ytd("income", -1);
  const expenses = ytd("expense", 1);

  const queues = [
    { label: "Waiting for approval", value: toApprove, href: "/accounts/transactions?status=submitted", show: staff.permissions.has("accounts.transactions.approve") },
    { label: "Approved, waiting to be paid", value: toPay, href: "/accounts/transactions?status=approved", show: staff.permissions.has("accounts.payments.pay") },
    { label: "Returned to you", value: returned, href: "/accounts/transactions?status=returned", show: true },
    { label: "Contributions to post", value: awaitingPosting, href: "/accounts/contributions", show: staff.permissions.has("accounts.receipts.record") },
    { label: "Draft journals", value: draftJournals, href: "/accounts/journals?status=draft", show: true },
    { label: "Unmatched bank lines", value: unmatched, href: "/accounts/bank", show: true },
  ].filter((q) => q.show);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Accounts"
        description="Receipts, payments, the ledger and bank reconciliation for the branches you work in."
        actions={
          <>
            {staff.permissions.has("accounts.receipts.record") && <ButtonLink href="/accounts/transactions/new?direction=receipt">Record receipt</ButtonLink>}
            {staff.permissions.has("accounts.payments.request") && (
              <ButtonLink href="/accounts/transactions/new?direction=payment" variant="secondary">
                Request payment
              </ButtonLink>
            )}
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {queues.map((q) => (
          <Link key={q.label} href={q.href} className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400">
            <p className="text-sm text-zinc-600">{q.label}</p>
            <p className="mt-1 text-2xl font-semibold">{q.value}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Bank and cash">
          <ul className="divide-y divide-zinc-100 text-sm">
            {banks.map((b) => (
              <li key={b.id} className="flex justify-between py-2">
                <span>
                  {b.name} <span className="text-xs text-zinc-500">{branchName.get(b.branch_id)}</span>
                </span>
                <span className="tabular-nums">{formatMoney(balanceOf.get(b.id) ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Year to date" actions={<Link href="/accounts/reports/profit-and-loss" className="text-sm underline">Profit and loss</Link>}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt>Income</dt>
              <dd className="tabular-nums">{formatMoney(income)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Expenses</dt>
              <dd className="tabular-nums">{formatMoney(expenses)}</dd>
            </div>
            <div className="flex justify-between border-t border-zinc-200 pt-2 font-medium">
              <dt>Surplus / (deficit)</dt>
              <dd className="tabular-nums">{formatMoney(income - expenses)}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
