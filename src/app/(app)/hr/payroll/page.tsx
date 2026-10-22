import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/format";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { hrModule } from "@/modules/hr/module";
import { approveSalary, createRun, rejectSalary } from "@/modules/hr/payroll/actions";
import { PrepareRunForm } from "@/modules/hr/payroll/components/forms";
import { COMPONENT_KEYS, RUN_STATUSES, SALARY_COMPONENTS, monthLabel, salaryTotal, thisMonth } from "@/modules/hr/payroll/constants";
import { listPendingSalaries, listRuns, personName } from "@/modules/hr/payroll/queries";

function nextMonth() {
  const d = new Date(`${thisMonth()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export default async function PayrollPage() {
  await requireModule(hrModule);
  const staff = await requirePermission("payroll.read");
  const canPrepare = staff.permissions.has("payroll.prepare");
  const canApproveSalaries = staff.permissions.has("payroll.salaries.approve");

  const [runs, pending] = await Promise.all([listRuns(), canApproveSalaries ? listPendingSalaries() : null]);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Payroll"
        description="Each month's pay: prepared by payroll, approved by the Financial Controller, then posted to the ledger."
        actions={
          <ButtonLink href="/hr/payroll/settings" variant="secondary">
            Tax and pension settings
          </ButtonLink>
        }
      />

      {canPrepare && (
        <PrepareRunForm action={createRun} defaultMonth={thisMonth()} maxMonth={nextMonth()} />
      )}

      <Card title="Payroll runs">
        {runs.length === 0 ? (
          <EmptyState>No payroll has been prepared yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-silver-50/60 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Month</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">People</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">PAYE</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(({ run, totals }) => {
                  const status = RUN_STATUSES[run.status];
                  return (
                    <tr key={run.id} className="border-b border-zinc-100 last:border-0 hover:bg-silver-50/60">
                      <td className="px-3 py-2">
                        <Link href={`/hr/payroll/${run.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                          {monthLabel(run.period)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {run.status === "draft" && run.return_reason && (
                          <span className="ml-2 text-xs text-red-700">Returned</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.people}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(totals.gross)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(totals.paye)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(totals.net)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pending && (
        <Card title="Salaries waiting for approval">
          {pending.salaries.length === 0 ? (
            <EmptyState>No salaries are waiting for approval.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {pending.salaries.map((s) => {
                const person = pending.person(s.employee_id);
                const mine = s.proposed_by === staff.id;
                return (
                  <li key={s.id} className="flex flex-wrap items-start justify-between gap-4 py-3 text-sm">
                    <div className="min-w-0 space-y-1">
                      <p>
                        <Link href={`/hr/employees/${s.employee_id}/pay`} className="font-medium text-ink hover:underline">
                          {personName(person)}
                        </Link>
                        {person && <span className="ml-2 font-mono text-xs text-zinc-500">{person.employee_no}</span>}
                      </p>
                      <p>
                        From {monthLabel(s.effective_from)}: <strong className="tabular-nums">{formatMoney(salaryTotal(s))}</strong> a month
                      </p>
                      <p className="text-xs text-zinc-600">
                        {COMPONENT_KEYS.filter((k) => Number(s[k]) > 0)
                          .map((k) => `${SALARY_COMPONENTS[k]} ${formatMoney(s[k])}`)
                          .join(" · ")}
                      </p>
                      <p className="text-zinc-700">{s.reason}</p>
                      <p className="text-xs text-zinc-500">
                        Proposed by {pending.staffName(s.proposed_by)}, {formatDate(s.proposed_at)}
                      </p>
                    </div>
                    {mine ? (
                      <p className="max-w-xs text-xs text-zinc-500">You proposed this, so someone else has to approve it.</p>
                    ) : (
                      <div className="flex flex-wrap items-start gap-2">
                        <ActionButton
                          action={approveSalary.bind(null, s.id)}
                          label="Approve"
                          confirm={`Approve ${formatMoney(salaryTotal(s))} a month for ${personName(person)} from ${monthLabel(s.effective_from)}?`}
                        />
                        <ReasonForm
                          action={rejectSalary.bind(null, s.id)}
                          openLabel="Reject"
                          submitLabel="Reject"
                          question="Why are you rejecting it?"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
