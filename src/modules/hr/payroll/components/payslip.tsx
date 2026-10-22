import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";
import { COMPONENT_KEYS, LINE_DEDUCTION_KINDS, RUN_STATUSES, SALARY_COMPONENTS, monthLabel } from "../constants";
import type { Payslip as PayslipData } from "../queries";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

function Row({ label, amount, strong }: { label: ReactNode; amount: number; strong?: boolean }) {
  return (
    <tr className={strong ? "border-t border-zinc-300 font-semibold" : "border-b border-zinc-100 last:border-0"}>
      <td className="py-1.5 pr-3">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{formatMoney(amount)}</td>
    </tr>
  );
}

/** A printable payslip. The figures are exactly those the payroll run worked out and posted. */
export function Payslip({ slip }: { slip: PayslipData }) {
  const { run, line: l, deductions, employee } = slip;
  const proRated = l.days_paid < l.days_in_month;

  const earnings: { label: string; amount: number }[] = [
    ...COMPONENT_KEYS.map((k) => ({ label: SALARY_COMPONENTS[k], amount: Number(l[k]) })),
    { label: "Commission", amount: Number(l.commission) },
    { label: "Other taxable pay", amount: Number(l.extra_taxable) },
    { label: "Non-taxable pay", amount: Number(l.extra_non_taxable) },
  ].filter((e) => e.amount !== 0 || e.label === SALARY_COMPONENTS.basic);

  const statutory = [
    { label: "Pension (employee)", amount: Number(l.pension_employee) },
    { label: "National Housing Fund", amount: Number(l.nhf) },
    { label: "PAYE tax", amount: Number(l.paye) },
  ].filter((d) => d.amount !== 0);
  const totalDeductions = Number(l.pension_employee) + Number(l.nhf) + Number(l.paye) + Number(l.deductions);

  return (
    <article className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <p className="text-lg font-semibold tracking-tight text-ink">Silverkuun Group</p>
          <p className="text-sm text-zinc-600">Payslip</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">{monthLabel(run.period)}</p>
          {run.status !== "approved" && <p className="text-xs font-medium text-amber-700">{RUN_STATUSES[run.status].label}: not final</p>}
          {proRated && (
            <p className="text-xs text-zinc-600">
              Paid for {l.days_paid} of {l.days_in_month} days
            </p>
          )}
        </div>
      </header>

      <dl className="grid gap-4 sm:grid-cols-4">
        <Detail label="Employee no.">{employee?.employee_no}</Detail>
        <Detail label="Name">{employee ? [employee.title, employee.first_name, employee.last_name].filter(Boolean).join(" ") : null}</Detail>
        <Detail label="Job title">{slip.jobTitle}</Detail>
        <Detail label="Department">{slip.department}</Detail>
        <Detail label="Branch">{slip.branch}</Detail>
        <Detail label="Bank">{l.bank_name}</Detail>
        <Detail label="Account number">{l.bank_account_number}</Detail>
        <Detail label="Pension PIN">{[l.pension_pin, l.pension_administrator].filter(Boolean).join(" · ")}</Detail>
        <Detail label="Tax ID (TIN)">{l.tax_id}</Detail>
      </dl>

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Earnings</h2>
          <table className="w-full text-sm">
            <tbody>
              {earnings.map((e) => (
                <Row key={e.label} label={e.label} amount={e.amount} />
              ))}
              <Row label="Gross pay" amount={Number(l.gross)} strong />
            </tbody>
          </table>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Deductions</h2>
          <table className="w-full text-sm">
            <tbody>
              {statutory.map((d) => (
                <Row key={d.label} label={d.label} amount={d.amount} />
              ))}
              {deductions.map((d) => (
                <Row
                  key={d.id}
                  label={
                    <>
                      {d.description}
                      <span className="ml-1 text-xs text-zinc-500">({LINE_DEDUCTION_KINDS[d.kind] ?? d.kind})</span>
                    </>
                  }
                  amount={Number(d.amount)}
                />
              ))}
              <Row label="Total deductions" amount={totalDeductions} strong />
            </tbody>
          </table>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-silver-50 px-4 py-3">
        <span className="text-sm font-medium">Net pay</span>
        <span className="text-xl font-semibold tabular-nums text-ink">{formatMoney(l.net)}</span>
      </div>

      <div className="grid gap-1 text-xs text-zinc-600">
        <p>Employer pension paid on your behalf (not deducted from your pay): {formatMoney(l.pension_employer)}</p>
        {Number(l.rent_relief) > 0 && <p>Rent relief allowed this month: {formatMoney(l.rent_relief)}</p>}
      </div>
    </article>
  );
}
