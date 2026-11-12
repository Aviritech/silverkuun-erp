import Link from "next/link";
import { ControlNote, StatCard, StatGrid } from "@/components/dashboard";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import { addDays, today } from "@/lib/reports/filters";
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
  const bankOnly = banks.filter((b) => b.kind === "bank");
  const lineCounts = new Map(
    await Promise.all(
      bankOnly.map(async (b) => {
        const { count, error: countError } = await supabase.from("bank_statement_lines").select("id", { count: "exact", head: true }).eq("bank_account_id", b.id);
        if (countError) throw dbFailure(countError);
        return [b.id, count ?? 0] as const;
      }),
    ),
  );
  const totalLines = [...lineCounts.values()].reduce((s, c) => s + c, 0);
  const unmatched = bankOnly.reduce((s, b) => s + (figures.get(b.id)?.unmatched_lines ?? 0), 0);
  const staleSince = addDays(today(), -31);
  const notReconciled = bankOnly.filter((b) => {
    const last = figures.get(b.id)?.last_reconciled;
    return !last || last < staleSince;
  }).length;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Bank workspace"
        title="Bank reconciliation"
        description="Import each bank's statement, match it to the books, and complete a reconciliation once the difference is explained."
      />
      <StatGrid>
        <StatCard label="Cash & bank (ledger)" icon="bank" value={formatMoneyShort(banks.reduce((s, b) => s + Number(figures.get(b.id)?.ledger_balance ?? 0), 0))} hint={`${banks.length} bank and cash accounts`} />
        <StatCard
          label="Statement lines matched"
          icon="check"
          tone="good"
          value={`${totalLines - unmatched} / ${totalLines}`}
          hint={totalLines ? `${Math.round(((totalLines - unmatched) / totalLines) * 100)}% matched or set aside` : "No statements imported yet"}
        />
        <StatCard label="Lines to review" icon="alert" tone={unmatched ? "warn" : "neutral"} value={unmatched} hint="Unmatched lines across all bank accounts" />
        <StatCard label="Not reconciled this month" icon="clock" tone={notReconciled ? "warn" : "neutral"} value={notReconciled} hint="Bank accounts with no reconciliation in 31 days" />
      </StatGrid>
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
                <th className="px-4 py-2 font-medium">Matched</th>
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
                    <td className="px-4 py-2">
                      {b.kind === "bank" && lineCounts.get(b.id) ? (
                        <MatchBar total={lineCounts.get(b.id)!} unmatched={f?.unmatched_lines ?? 0} />
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
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
      <ControlNote title="Safe posting">
        Duplicate statement lines are refused on import, uncertain suggestions wait for someone to confirm them, and the source file and every
        match stay in the audit trail. Cash accounts aren&apos;t reconciled to a statement; count the cash against the ledger balance instead.
      </ControlNote>
    </div>
  );
}

function MatchBar({ total, unmatched }: { total: number; unmatched: number }) {
  const pct = Math.round(((total - unmatched) / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-zinc-600">{pct}%</span>
    </div>
  );
}
