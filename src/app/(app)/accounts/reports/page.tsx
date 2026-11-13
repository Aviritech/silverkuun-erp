import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { today } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { accountsModule } from "@/modules/accounts/module";
import { locationSummary } from "@/modules/accounts/position-reports";
import { accountsReports } from "@/modules/accounts/reports";
import { accountsLoanPortfolio, accountsPortfolioAtRisk } from "@/modules/credit/reports";

const STATEMENTS = ["profit-and-loss", "balance-sheet", "cash-flow", "trial-balance", "general-ledger"];

export default async function AccountsReportsPage() {
  await requireModule(accountsModule);
  await requirePermission("accounts.read");
  const supabase = await createClient();
  const asAt = today();
  const summary = await locationSummary.run(supabase, { from: asAt, to: asAt, branch: null, region: null, department: null, product: null, options: {} });
  // The region totals and the Society total; the branch rows are in the full report.
  const rollup = summary.rows.filter((r) => r._kind === "subtotal" || r._kind === "total");
  const all = [...accountsReports, accountsLoanPortfolio, accountsPortfolioAtRisk].filter((r) => r.key !== locationSummary.key);
  const statements = all.filter((r) => STATEMENTS.includes(r.key));
  const schedules = all.filter((r) => !STATEMENTS.includes(r.key));
  const money = summary.columns.filter((c) => c.kind === "money");

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Financial reporting"
        title="State and consolidated reports"
        description="Compare each region, then the combined Society total. Every report filters by period, branch and region and downloads to Excel, PDF or CSV."
      />
      <Card title="Location summary today" actions={<Link href="/accounts/reports/location-summary" className="text-xs font-medium text-ink underline">Branch detail and download</Link>}>
        <div className="-mx-5 -my-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-100 text-xs text-zinc-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Region</th>
                {money.map((c) => (
                  <th key={c.key} className="px-5 py-2.5 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rollup.map((r) => (
                <tr key={String(r.name)} className={`border-b border-zinc-100 last:border-0 ${r._kind === "total" ? "bg-neutral-50 font-semibold" : ""}`}>
                  <td className="px-5 py-2.5">{String(r.name).replace(/ total$/, "")}</td>
                  {money.map((c) => (
                    <td key={c.key} className="px-5 py-2.5 text-right tabular-nums">
                      {formatMoney(r[c.key] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {[
        { title: "Financial statements", list: statements },
        { title: "Operational schedules", list: schedules },
      ].map((group) => (
        <section key={group.title}>
          <h2 className="mb-3 text-[15px] font-semibold text-ink">{group.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.list.map((r) => (
              <Link key={r.key} href={`/accounts/reports/${r.key}`} className="rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400">
                <h3 className="font-medium text-ink">{r.title}</h3>
                <p className="mt-1 text-sm text-zinc-600">{r.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="text-sm text-zinc-500">
        Regions and branches come from the organisation set-up, so the summary follows Kuun&apos;s own branch-to-region mapping. Budget against
        actual needs an approved budget, which arrives with that workflow. The loan figures read the Credit department&apos;s loan book; its
        disbursements and repayments are the ones posted here.
      </p>
    </div>
  );
}
