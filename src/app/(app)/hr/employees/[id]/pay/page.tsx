import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/format";
import { hrModule } from "@/modules/hr/module";
import { addDeduction, proposeSalary, stopDeduction, withdrawSalary } from "@/modules/hr/payroll/actions";
import { DeductionForm, SalaryForm } from "@/modules/hr/payroll/components/forms";
import {
  COMPONENT_KEYS,
  DEDUCTION_KINDS,
  RUN_STATUSES,
  SALARY_COMPONENTS,
  SALARY_STATUSES,
  monthLabel,
  salaryTotal,
  thisMonth,
} from "@/modules/hr/payroll/constants";
import { getEmployeePay, personName } from "@/modules/hr/payroll/queries";

const COMMISSION_STATUSES = {
  approved: { label: "To be paid", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
} as const;

export default async function EmployeePayPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(hrModule);
  const staff = await requirePermission("payroll.read");
  const { id } = await params;
  const pay = await getEmployeePay(id);
  if (!pay) notFound();
  const { employee: e, salaries, deductions, recovered, commissions, payslips, staffName } = pay;

  const canPrepare = staff.permissions.has("payroll.prepare");
  const isCurrent = e.status === "probation" || e.status === "active";
  const isSelf = e.staff_id === staff.id;
  const today = thisMonth();
  const current = salaries.find((s) => s.status === "approved" && s.effective_from <= today);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={`Pay: ${personName(e)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{e.employee_no}</span>
            <span>
              {current ? `${formatMoney(salaryTotal(current))} a month since ${monthLabel(current.effective_from)}` : "No approved salary in force"}
            </span>
          </span>
        }
        actions={
          <ButtonLink href={`/hr/employees/${e.id}`} variant="secondary">
            Employee record
          </ButtonLink>
        }
      />

      <Card title="Tax and pension">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500">Annual rent (for rent relief)</dt>
            <dd className="mt-0.5">{e.annual_rent ? formatMoney(e.annual_rent) : "None recorded"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Pension</dt>
            <dd className="mt-0.5">{e.pension_applies ? "Deducted" : "Not deducted"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">National Housing Fund</dt>
            <dd className="mt-0.5">{e.nhf_applies ? "Deducted" : "Not deducted"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-zinc-500">HR changes these on the employee&apos;s Edit details page.</p>
      </Card>

      <Card
        title="Salary"
        actions={canPrepare && isCurrent && <SalaryForm action={proposeSalary.bind(null, e.id)} defaultMonth={today} />}
      >
        {isSelf && canPrepare && <p className="mb-3 text-xs text-zinc-500">This is your own record, so someone else has to approve any salary for you.</p>}
        {salaries.length === 0 ? (
          <EmptyState>No salary proposed yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {salaries.map((s) => {
              const status = SALARY_STATUSES[s.status];
              return (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">From {monthLabel(s.effective_from)}</span>
                      <strong className="tabular-nums">{formatMoney(salaryTotal(s))}</strong>
                      <span className="text-zinc-500">a month</span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {s.id === current?.id && <Badge tone="green">In force</Badge>}
                    </p>
                    <p className="text-xs text-zinc-600">
                      {COMPONENT_KEYS.filter((k) => Number(s[k]) > 0)
                        .map((k) => `${SALARY_COMPONENTS[k]} ${formatMoney(s[k])}`)
                        .join(" · ")}
                    </p>
                    <p className="text-zinc-700">{s.reason}</p>
                    <p className="text-xs text-zinc-500">
                      Proposed by {staffName(s.proposed_by)}, {formatDate(s.proposed_at)}
                      {s.decided_by && (
                        <>
                          {" "}
                          · {s.status === "approved" ? "Approved" : "Rejected"} by {staffName(s.decided_by)}, {formatDate(s.decided_at)}
                        </>
                      )}
                    </p>
                    {s.decision_note && <p className="text-xs text-red-700">{s.decision_note}</p>}
                  </div>
                  {s.status === "pending" && canPrepare && s.proposed_by === staff.id && (
                    <ActionButton
                      action={withdrawSalary.bind(null, e.id, s.id)}
                      label="Withdraw"
                      variant="secondary"
                      confirm="Withdraw this proposed salary?"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Recurring deductions"
        actions={canPrepare && isCurrent && <DeductionForm action={addDeduction.bind(null, e.id)} defaultMonth={today} />}
      >
        {deductions.length === 0 ? (
          <EmptyState>No deductions.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {deductions.map((d) => {
              const got = recovered(d.id);
              const remaining = d.total_amount === null ? null : Math.max(0, Number(d.total_amount) - got);
              const finished = remaining === 0 || (d.end_month !== null && d.end_month < today);
              return (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.description}</span>
                      <span className="text-zinc-500">{DEDUCTION_KINDS[d.kind]}</span>
                      {!d.is_active ? <Badge tone="gray">Stopped</Badge> : finished ? <Badge tone="gray">Finished</Badge> : <Badge tone="green">Active</Badge>}
                    </p>
                    <p>
                      {formatMoney(d.monthly_amount)} a month from {monthLabel(d.start_month)}
                      {d.end_month && ` to ${monthLabel(d.end_month)}`}
                    </p>
                    <p className="text-xs text-zinc-600">
                      Recovered so far {formatMoney(got)}
                      {d.total_amount !== null && ` of ${formatMoney(d.total_amount)}; ${formatMoney(remaining)} left`}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Added by {staffName(d.created_by)}, {formatDate(d.created_at)}
                    </p>
                  </div>
                  {canPrepare && d.is_active && !finished && (
                    <ActionButton
                      action={stopDeduction.bind(null, e.id, d.id)}
                      label="Stop"
                      variant="danger"
                      confirm={`Stop "${d.description}"? It won't be taken from future payrolls.`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500">Amounts count as recovered once the payroll they were in is approved.</p>
      </Card>

      <Card title="Commission">
        {commissions.length === 0 ? (
          <EmptyState>No commission.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {commissions.map((c) => {
              const status = COMMISSION_STATUSES[c.status];
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>
                    {c.description}
                    <span className="ml-2 text-xs text-zinc-500">payable from {formatDate(c.payable_from)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatMoney(c.amount)}</span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Payslips">
        {payslips.length === 0 ? (
          <EmptyState>Not on any payroll yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {payslips.map((p) => {
              const status = RUN_STATUSES[p.payroll_runs.status];
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2">
                    <Link href={`/hr/payroll/${p.run_id}/payslips/${p.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                      {monthLabel(p.payroll_runs.period)}
                    </Link>
                    {p.payroll_runs.status !== "approved" && <Badge tone={status.tone}>{status.label}</Badge>}
                  </span>
                  <span className="tabular-nums">
                    Net {formatMoney(p.net)} <span className="text-xs text-zinc-500">of {formatMoney(p.gross)} gross</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
