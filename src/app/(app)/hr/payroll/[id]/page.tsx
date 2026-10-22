import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { hrModule } from "@/modules/hr/module";
import {
  addAdjustment,
  approveRun,
  cancelRun,
  recalculateRun,
  removeAdjustment,
  returnRun,
  submitRun,
} from "@/modules/hr/payroll/actions";
import { AdjustmentForm } from "@/modules/hr/payroll/components/forms";
import { ADJUSTMENT_KINDS, RUN_STATUSES, monthLabel } from "@/modules/hr/payroll/constants";
import { getRunBundle, personName, runTotals } from "@/modules/hr/payroll/queries";

function Total({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{formatMoney(value)}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Banner({ tone, children }: { tone: "amber" | "blue" | "green" | "gray" | "red"; children: ReactNode }) {
  const styles = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-sky-200 bg-sky-50 text-sky-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    gray: "border-zinc-200 bg-zinc-50 text-zinc-800",
    red: "border-red-200 bg-red-50 text-red-900",
  };
  return <div className={`space-y-1 rounded-xl border p-4 text-sm ${styles[tone]}`}>{children}</div>;
}

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(hrModule);
  const staff = await requirePermission("payroll.read");
  const { id } = await params;
  const bundle = await getRunBundle(id);
  if (!bundle) notFound();
  const { run, lines, adjustments, missing, journals, person, staffName } = bundle;

  const isDraft = run.status === "draft";
  const canPrepare = staff.permissions.has("payroll.prepare");
  const canApprove = staff.permissions.has("payroll.approve");
  const preparedIt = staff.id === run.prepared_by || staff.id === run.submitted_by;
  const totals = runTotals(lines);
  const month = monthLabel(run.period);
  const status = RUN_STATUSES[run.status];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={`Payroll for ${month}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>
              {totals.people} {totals.people === 1 ? "person" : "people"}
            </span>
            <span>· Tax settings from {monthLabel(run.settings_from)}</span>
            <Link href="/hr/payroll" className="underline-offset-4 hover:underline">
              · All payroll runs
            </Link>
          </span>
        }
        actions={
          <>
            {isDraft && canPrepare && (
              <>
                <ActionButton action={recalculateRun.bind(null, run.id)} label="Recalculate" pendingLabel="Recalculating…" variant="secondary" />
                <ActionButton
                  action={submitRun.bind(null, run.id)}
                  label="Submit for approval"
                  pendingLabel="Submitting…"
                  disabled={lines.length === 0}
                  title={lines.length === 0 ? "Nobody is on this payroll yet" : undefined}
                  confirm={`Submit the ${month} payroll for approval? It is recalculated once more first, and can't be changed while it waits.`}
                />
                <ActionButton
                  action={cancelRun.bind(null, run.id)}
                  label="Cancel payroll"
                  variant="danger"
                  confirm={`Cancel the ${month} payroll? You can prepare the month again afterwards.`}
                />
              </>
            )}
            {run.status === "submitted" && canApprove && (
              <>
                <ActionButton
                  action={approveRun.bind(null, run.id)}
                  label="Approve and post"
                  pendingLabel="Approving…"
                  disabled={preparedIt}
                  title={preparedIt ? "You prepared or submitted this payroll, so someone else must approve it" : undefined}
                  confirm={`Approve the ${month} payroll? Net pay of ${formatMoney(totals.net)} is posted to the ledger and payslips go to employees.`}
                />
                <ReasonForm action={returnRun.bind(null, run.id)} openLabel="Return" submitLabel="Return" question="What needs correcting?" />
              </>
            )}
          </>
        }
      />

      {/* Where the run is */}
      {isDraft && run.return_reason && (
        <Banner tone="red">
          <p className="font-medium">Returned for correction</p>
          <p>{run.return_reason}</p>
        </Banner>
      )}
      {isDraft && (
        <Banner tone="amber">
          <p>
            Draft, prepared by {staffName(run.prepared_by)} on {formatDateTime(run.prepared_at)}. After changing salaries, deductions or
            adjustments, press Recalculate to update the figures.
          </p>
        </Banner>
      )}
      {run.status === "submitted" && (
        <Banner tone="blue">
          <p>
            Submitted by {staffName(run.submitted_by)} on {formatDateTime(run.submitted_at)}. Waiting for the Financial Controller to approve
            it.
          </p>
          {canApprove && preparedIt && <p>You prepared or submitted this payroll, so someone else has to approve it.</p>}
        </Banner>
      )}
      {run.status === "approved" && (
        <Banner tone="green">
          <p>
            Approved by {staffName(run.approved_by)} on {formatDateTime(run.approved_at)} and posted to the ledger. Employees can now see
            their payslips.
          </p>
        </Banner>
      )}
      {run.status === "cancelled" && (
        <Banner tone="gray">
          <p>Cancelled. Nothing from this run was paid or posted.</p>
        </Banner>
      )}
      {run.note && <p className="text-sm text-zinc-700">Note: {run.note}</p>}

      {/* Totals */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Total label="Gross pay" value={totals.gross} />
        <Total label="Pension" value={totals.pension_employee + totals.pension_employer} hint={`${formatMoney(totals.pension_employee)} employee, ${formatMoney(totals.pension_employer)} employer`} />
        <Total label="NHF" value={totals.nhf} />
        <Total label="PAYE" value={totals.paye} />
        <Total label="Other deductions" value={totals.deductions} />
        <Total label="Net pay" value={totals.net} />
        <Total label="Cost to the company" value={totals.gross + totals.pension_employer} hint="Gross pay plus employer pension" />
      </div>

      {missing.length > 0 && (
        <Banner tone="amber">
          <p className="font-medium">
            {missing.length === 1 ? "1 person employed this month isn't" : `${missing.length} people employed this month aren't`} on this
            payroll because they have no approved salary:
          </p>
          <ul className="list-inside list-disc">
            {missing.map((m) => (
              <li key={m.employee_id}>
                <Link href={`/hr/employees/${m.employee_id}/pay`} className="underline underline-offset-4">
                  {m.full_name}
                </Link>{" "}
                <span className="font-mono text-xs">{m.employee_no}</span>
              </li>
            ))}
          </ul>
          <p>Once their salaries are approved, recalculate this payroll.</p>
        </Banner>
      )}

      {/* Lines */}
      <Card title="Employees">
        {lines.length === 0 ? (
          <EmptyState>Nobody is on this payroll yet. Approve salaries first, then recalculate.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-silver-50/60 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">No.</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 text-right font-medium">Days</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">Pension</th>
                  <th className="px-3 py-2 text-right font-medium">NHF</th>
                  <th className="px-3 py-2 text-right font-medium">PAYE</th>
                  <th className="px-3 py-2 text-right font-medium">Deductions</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const p = person(l.employee_id);
                  return (
                    <tr key={l.id} className="border-b border-zinc-100 last:border-0 hover:bg-silver-50/60">
                      <td className="px-3 py-2 font-mono text-xs">{p?.employee_no ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Link href={`/hr/payroll/${run.id}/payslips/${l.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                          {personName(p)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{bundle.branch(l.branch_id)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.days_paid < l.days_in_month ? `${l.days_paid} of ${l.days_in_month}` : ""}
                      </td>
                      {[l.gross, l.pension_employee, l.nhf, l.paye, l.deductions, l.net].map((v, i) => (
                        <td key={i} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${i === 5 ? "font-medium" : ""}`}>
                          {formatMoney(v)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Adjustments */}
      <Card
        title="Bonuses and one-off adjustments"
        actions={
          isDraft &&
          canPrepare &&
          lines.length > 0 && (
            <AdjustmentForm
              action={addAdjustment.bind(null, run.id)}
              employees={lines.map((l) => {
                const p = person(l.employee_id);
                return { id: l.employee_id, label: `${personName(p)}${p ? ` (${p.employee_no})` : ""}` };
              })}
            />
          )
        }
      >
        {adjustments.length === 0 ? (
          <EmptyState>No adjustments this month.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{personName(person(a.employee_id))}</span>
                  <span className="ml-2">
                    {ADJUSTMENT_KINDS[a.kind]}: {a.description}
                  </span>
                  <span className="ml-2 tabular-nums">{a.kind === "deduction" ? `−${formatMoney(a.amount)}` : formatMoney(a.amount)}</span>
                  {a.kind !== "deduction" && !a.taxable && <span className="ml-2 text-xs text-zinc-500">not taxed</span>}
                  <span className="block text-xs text-zinc-500">
                    Added by {staffName(a.created_by)}, {formatDate(a.created_at)}
                  </span>
                </span>
                {isDraft && canPrepare && (
                  <ActionButton
                    action={removeAdjustment.bind(null, run.id, a.id)}
                    label="Remove"
                    variant="secondary"
                    confirm={`Remove "${a.description}"? Recalculate afterwards to update the figures.`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {isDraft && adjustments.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">The figures above include adjustments only after you press Recalculate.</p>
        )}
      </Card>

      {/* Posting */}
      {run.status === "approved" && (
        <Card title="Posted to the ledger">
          {journals.length === 0 ? (
            <p className="text-sm text-zinc-600">One journal was posted for each branch. You need Accounts access to see them.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {journals.map((j) => (
                <li key={j.id} className="flex justify-between gap-3 py-2">
                  <Link href={`/accounts/journals/${j.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                    {j.entry_no}
                  </Link>
                  <span className="text-zinc-600">{bundle.branch(j.branch_id)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 rounded-lg bg-silver-50 p-3 text-sm text-zinc-700">
            <p className="font-medium">For Accounts</p>
            <p>
              Pay net salaries ({formatMoney(totals.net)}) with the &ldquo;Net salaries paid&rdquo; payment type. Remit PAYE (
              {formatMoney(totals.paye)}) with &ldquo;Tax and statutory remittance&rdquo;, pension ({formatMoney(totals.pension_employee + totals.pension_employer)})
              with &ldquo;Pension remitted to PFAs&rdquo; and NHF ({formatMoney(totals.nhf)}) with &ldquo;NHF remitted to FMBN&rdquo;.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
