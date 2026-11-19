import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ControlNote } from "@/components/dashboard";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { runMonthEnd } from "../closing-actions";
import { periodName, type CloseReport, type NextMonth, type PeriodClose } from "../closing";
import { CloseReportView } from "./close-report";
import { CloseMonthForm } from "./month-end-form";

/** The month and year end page, given its data. */
export function ClosingView({
  next,
  preview,
  periods,
  staffName,
  canClose,
}: {
  next: NextMonth;
  preview: CloseReport;
  periods: PeriodClose[];
  staffName: (id: string | null) => string;
  canClose: boolean;
}) {
  const month = periodName("month", next.period_end);
  const yearEnd = next.period_end.slice(5, 7) === "12";
  const u = preview.unfinished;
  const unfinished = u ? u.transactions_draft + u.transactions_submitted + u.transactions_approved + u.journals_draft + u.pay_ins_to_post : 0;
  const label = yearEnd ? `Close ${month} and the year ${next.period_end.slice(0, 4)}` : `Close ${month}`;
  const warning = [
    unfinished ? `${unfinished} item${unfinished === 1 ? " is" : "s are"} still unfinished (see "Unfinished work"). They carry over.` : "",
    yearEnd ? "This also closes the year: income and expenses go to 3200 Accumulated surplus and the year is locked." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Accounts · Control"
        title="Month and year end"
        description="Close each month once its books are complete. Closing December also closes the year."
      />

      <Card title={`Next to close: ${month}`}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            {next.closed_through ? `Books are closed up to ${formatDate(next.closed_through)}.` : "No month has been closed yet."}{" "}
            {next.has_ended ? "" : `${month} hasn't ended yet, so it can be closed from ${formatDate(nextDay(next.period_end))}.`}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700">
            <li>Checks the ledger balances; it stops if debits don&apos;t equal credits.</li>
            {yearEnd && <li>Closes the year&apos;s income and expenses to 3200 Accumulated surplus and saves the year report.</li>}
            <li>Saves the month report below and locks {month}.</li>
          </ol>
          {canClose && next.has_ended ? (
            <CloseMonthForm action={runMonthEnd} monthEnd={next.period_end} label={label} warning={warning || undefined} />
          ) : !canClose ? (
            <p className="text-sm text-zinc-500">The Financial Controller or a Month-end Officer closes the month.</p>
          ) : null}
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-ink">{month} so far</h2>
        <CloseReportView report={preview} />
      </div>

      <Card title="Closed months and years">
        {periods.length === 0 ? (
          <EmptyState>No month has been closed yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Period</th>
                  <th className="py-1 pr-3 font-medium">Closed</th>
                  <th className="py-1 pr-3 text-right font-medium">Money in</th>
                  <th className="py-1 pr-3 text-right font-medium">Money out</th>
                  <th className="py-1 pr-3 text-right font-medium">Surplus / (deficit)</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5 pr-3 font-medium">{periodName(p.period_kind, p.period_end)}</td>
                    <td className="py-1.5 pr-3 text-zinc-600">
                      {formatDateTime(p.closed_at)} by {staffName(p.closed_by)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(p.report.cash.money_in)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(p.report.cash.money_out)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(p.report.profit_and_loss.surplus)}</td>
                    <td className="py-1.5 text-right">
                      <Link href={`/accounts/closing/period/${p.id}`} className="text-sm font-medium text-ink underline">
                        Report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ControlNote title="Locked">
          No journal entry can be posted with a date in a closed month. Receipts, payments and other postings dated in a closed month go on the
          first day after it; the transaction keeps its own date. A manual journal must be dated after the last closed month.
        </ControlNote>
      </Card>
    </div>
  );
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
