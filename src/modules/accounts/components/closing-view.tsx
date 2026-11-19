import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ControlNote } from "@/components/dashboard";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { runEndOfDay, saveDayEndSettings } from "../closing-actions";
import { isMonthEnd, periodName, type BusinessDateStatus, type BusinessDay, type CloseReport, type PeriodClose } from "../closing";
import { CloseReportView } from "./close-report";
import { CloseDayForm, DayEndSettingsForm } from "./day-end-forms";

/** The End of Day page, given its data. */
export function ClosingView({
  status,
  preview,
  days,
  periods,
  staffName,
  permissions,
  today,
}: {
  status: BusinessDateStatus | null;
  preview: CloseReport;
  days: BusinessDay[];
  periods: PeriodClose[];
  staffName: (id: string | null) => string;
  permissions: { close: boolean; configure: boolean };
  /** Today's date in Lagos (YYYY-MM-DD). */
  today: string;
}) {
  const canClose = permissions.close;
  const canConfigure = permissions.configure;
  const date = status?.business_date ?? null;
  const monthEnd = date ? isMonthEnd(date) : false;
  const yearEnd = monthEnd && date?.slice(5, 7) === "12";
  const u = preview.unfinished;
  const unfinished = u ? u.transactions_draft + u.transactions_submitted + u.transactions_approved + u.journals_draft + u.pay_ins_to_post : 0;
  const whoCloses = (mode: string | null, by: string | null) => (mode === "automatic" ? "The system" : staffName(by));

  const label = yearEnd ? "Run End of Day, Month and Year" : monthEnd ? "Run End of Day and Month" : "Run End of Day";
  const warning = [
    unfinished ? `${unfinished} item${unfinished === 1 ? " is" : "s are"} still unfinished (see "Due and unfinished"). They carry over to the next day.` : "",
    yearEnd ? "This is the last day of the year: income and expenses will be closed to accumulated surplus and the year locked." : "",
    monthEnd && !yearEnd ? "This is the last day of the month: the month report will be saved." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Accounts · Control"
        title="End of day"
        description="The system works on a business date. End of Day closes it and opens the next; on the last day of a month it also runs End of Month, and on 31 December End of Year."
      />

      <Card
        title={date ? `Business date: ${formatDate(date)}` : "Business date"}
        actions={date && date < today ? <Badge tone="amber">Behind the calendar</Badge> : <Badge tone="green">Open</Badge>}
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            {status?.last_closed ? `Books closed up to ${formatDate(status.last_closed)}. ` : "No day has been closed yet. "}
            {status?.auto_close
              ? `If nobody closes the day, the system closes it at ${status.auto_close_at.slice(0, 5)} Lagos time.`
              : "The day stays open until someone closes it."}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700">
            <li>Takes unpaid loan late fees from borrowers&apos; savings for the day.</li>
            <li>Checks the ledger balances; it stops if debits don&apos;t equal credits.</li>
            {monthEnd && <li>Saves the month report{yearEnd ? ", and closes the year's income and expenses to 3200 Accumulated surplus" : ""}.</li>}
            <li>Saves the day-end report below, locks the day and opens {date ? formatDate(nextDay(date)) : "the next day"}.</li>
          </ol>
          {canClose && date && date <= today ? (
            <CloseDayForm action={runEndOfDay} businessDate={date} label={label} warning={warning || undefined} />
          ) : canClose ? (
            <p className="text-sm text-zinc-500">{date ? `${formatDate(date)} hasn't started yet.` : ""}</p>
          ) : (
            <p className="text-sm text-zinc-500">The Financial Controller or an End of Day Officer closes the day.</p>
          )}
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-ink">{date ? `${formatDate(date)} so far` : "Today so far"}</h2>
        <CloseReportView report={preview} />
      </div>

      <Card title="Automatic close">
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">
            {status?.auto_close
              ? `On. If the day is still open at ${status.auto_close_at.slice(0, 5)} Lagos time, the system closes it, and it closes any earlier day left open.`
              : "Off. A day stays open until the Financial Controller or an End of Day Officer closes it."}
          </p>
          {canConfigure && status && <DayEndSettingsForm action={saveDayEndSettings} autoClose={status.auto_close} autoCloseAt={status.auto_close_at} />}
        </div>
      </Card>

      <Card title="Month and year closes">
        {periods.length === 0 ? (
          <EmptyState>No month has closed yet.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Period</th>
                <th className="py-1 pr-3 font-medium">Closed</th>
                <th className="py-1 pr-3 text-right font-medium">Surplus / (deficit)</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {periods.map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 pr-3">{periodName(p.period_kind, p.period_end)}</td>
                  <td className="py-1.5 pr-3 text-zinc-600">
                    {formatDateTime(p.closed_at)} by {whoCloses(p.close_mode, p.closed_by)}
                  </td>
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
        )}
      </Card>

      <Card title="Closed days">
        {days.length === 0 ? (
          <EmptyState>No day has been closed yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Business date</th>
                  <th className="py-1 pr-3 font-medium">Closed</th>
                  <th className="py-1 pr-3 text-right font-medium">Money in</th>
                  <th className="py-1 pr-3 text-right font-medium">Money out</th>
                  <th className="py-1 pr-3 text-right font-medium">Cash and bank</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {days.map((d) => (
                  <tr key={d.business_date}>
                    <td className="py-1.5 pr-3">{formatDate(d.business_date)}</td>
                    <td className="py-1.5 pr-3 text-zinc-600">
                      {formatDateTime(d.closed_at)} by {whoCloses(d.close_mode, d.closed_by)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(d.report?.cash.money_in)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(d.report?.cash.money_out)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(d.report?.cash.closing)}</td>
                    <td className="py-1.5 text-right">
                      <Link href={`/accounts/closing/${d.business_date}`} className="text-sm font-medium text-ink underline">
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
          No journal entry can be posted on or before a closed day. Receipts, payments and other postings with an earlier date go on the open
          business date; the transaction keeps its own date. A manual journal must be dated on or after the open business date.
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
