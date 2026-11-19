import { formatMoney } from "@/lib/format";
import { Card } from "@/components/ui";
import { SOURCE_LABELS, type CloseReport } from "../closing";

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Lines({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-zinc-100 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-1.5">
          <dt className="text-zinc-600">{k}</dt>
          <dd className="tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The saved End of Day, Month or Year figures. */
export function CloseReportView({ report }: { report: CloseReport }) {
  const balanced = Number(report.trial_balance.debits) === Number(report.trial_balance.credits);
  const u = report.unfinished;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Money in" value={formatMoney(report.cash.money_in)} hint={`${report.receipts.count} receipts, ${formatMoney(report.receipts.amount)}`} />
        <Figure label="Money out" value={formatMoney(report.cash.money_out)} hint={`${report.payments.count} payments, ${formatMoney(report.payments.amount)}`} />
        <Figure label="Cash and bank at close" value={formatMoney(report.cash.closing)} hint={`Opened at ${formatMoney(report.cash.opening)}`} />
        <Figure
          label="Surplus / (deficit)"
          value={formatMoney(report.profit_and_loss.surplus)}
          hint={`Income ${formatMoney(report.profit_and_loss.income)}, expenses ${formatMoney(report.profit_and_loss.expenses)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ledger">
          <Lines
            rows={[
              ["Journal entries posted", String(report.ledger.entries)],
              ["Debits", formatMoney(report.ledger.debits)],
              ["Credits", formatMoney(report.ledger.credits)],
              ["Whole ledger", balanced ? "Debits equal credits" : "Does not balance"],
              ...report.by_source.map((s): [string, string] => [`${SOURCE_LABELS[s.source] ?? s.source} (${s.entries})`, formatMoney(s.amount)]),
            ]}
          />
        </Card>
        <Card title="Financial position at close">
          <Lines
            rows={[
              ["Assets", formatMoney(report.position.assets)],
              ["Liabilities", formatMoney(report.position.liabilities)],
              ["Accumulated funds", formatMoney(report.position.funds)],
              ["Member savings", formatMoney(report.position.member_savings)],
              ["Loans outstanding", formatMoney(report.position.loans_outstanding)],
            ]}
          />
        </Card>
        <Card title="Loans">
          <Lines
            rows={[
              ["Active loans", String(report.loans.active)],
              ["Disbursed in the period", String(report.loans.disbursed)],
              ["Outstanding principal", formatMoney(report.loans.outstanding_principal)],
              ["Overdue", formatMoney(report.loans.overdue)],
              ["Portfolio at risk (over 30 days)", formatMoney(report.loans.par30)],
              ["Late fees still owed", formatMoney(report.loans.penalty_outstanding)],
              [`Late fees taken from savings (${report.late_fees_from_savings.count})`, formatMoney(report.late_fees_from_savings.amount)],
            ]}
          />
        </Card>
        {(report.interest_due || u) && (
          <Card title="Due and unfinished">
            <Lines
              rows={[
                ...(report.interest_due
                  ? [[`Interest due to members (${report.interest_due.members})`, formatMoney(report.interest_due.amount)] as [string, string]]
                  : []),
                ...(u
                  ? ([
                      ["Receipts and payments in draft or returned", String(u.transactions_draft)],
                      ["Waiting for approval", String(u.transactions_submitted)],
                      ["Approved, not yet paid or posted", String(u.transactions_approved)],
                      ["Draft journals dated this day or earlier", String(u.journals_draft)],
                      ["Savings pay-ins waiting to be posted", String(u.pay_ins_to_post)],
                    ] as [string, string][])
                  : []),
              ]}
            />
          </Card>
        )}
      </div>

      {report.by_branch.length > 0 && (
        <Card title="By branch">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Branch</th>
                  <th className="py-1 pr-3 text-right font-medium">Entries</th>
                  <th className="py-1 pr-3 text-right font-medium">Money in</th>
                  <th className="py-1 pr-3 text-right font-medium">Money out</th>
                  <th className="py-1 text-right font-medium">Surplus / (deficit)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {report.by_branch.map((b) => (
                  <tr key={b.branch}>
                    <td className="py-1.5 pr-3">{b.branch}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{b.entries}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(b.money_in)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(b.money_out)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(b.surplus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
