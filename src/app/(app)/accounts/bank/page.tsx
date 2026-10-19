import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts } from "@/modules/accounts/queries";

export default async function BankAccountsPage() {
  await requireModule(accountsModule);
  await requirePermission("accounts.read");
  const supabase = await createClient();
  const [banks, { data, error }, org] = await Promise.all([listBankAccounts(), supabase.from("bank_account_balances").select("*"), listOrg()]);
  if (error) throw dbFailure(error);
  const figures = new Map((data as { bank_account_id: string; ledger_balance: string; unmatched_lines: number; last_statement_date: string | null; last_reconciled: string | null }[]).map((f) => [f.bank_account_id, f]));
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Bank reconciliation"
        description="Import each bank's statement, match it to the books, and complete a reconciliation once the difference is explained."
      />
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {banks.length === 0 ? (
          <EmptyState>No bank accounts yet. Add one under Settings.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 text-right font-medium">Ledger balance</th>
                <th className="px-4 py-2 text-right font-medium">Unmatched lines</th>
                <th className="px-4 py-2 font-medium">Latest statement</th>
                <th className="px-4 py-2 font-medium">Last reconciled</th>
              </tr>
            </thead>
            <tbody>
              {banks.map((b) => {
                const f = figures.get(b.id);
                return (
                  <tr key={b.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="px-4 py-2">
                      {b.kind === "bank" ? (
                        <Link href={`/accounts/bank/${b.id}`} className="font-medium hover:underline">
                          {b.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{b.name}</span>
                      )}
                      <span className="block text-xs text-zinc-500">
                        {b.kind === "bank" ? `${b.bank_name ?? ""} ${b.account_number ?? ""}` : "Cash"} · ledger {b.ledger_account_code}
                      </span>
                    </td>
                    <td className="px-4 py-2">{branchName.get(b.branch_id)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(f?.ledger_balance)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.kind === "bank" ? (f?.unmatched_lines ?? 0) : "—"}</td>
                    <td className="px-4 py-2">{formatDate(f?.last_statement_date)}</td>
                    <td className="px-4 py-2">{formatDate(f?.last_reconciled)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-500">Cash accounts aren&apos;t reconciled to a statement; count the cash against the ledger balance instead.</p>
    </div>
  );
}
