import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { staffNameLookup } from "@/modules/accounts/queries";
import { approveSale, cancelTarget, closeTarget, recordSale, rejectSale, removeSale } from "@/modules/hr/commissions/actions";
import {
  COMMISSION_METHODS,
  PAYOUT_STATUSES,
  SALE_STATUSES,
  TARGET_STATUSES,
  commissionFor,
  describeTerms,
} from "@/modules/hr/commissions/constants";
import { RejectSaleForm, SaleForm } from "@/modules/hr/commissions/forms";
import { TargetProgress } from "@/modules/hr/commissions/progress";
import { getTarget, payPeople, requireCommissionAccess } from "@/modules/hr/commissions/queries";
import { getMyEmployee } from "@/modules/me/queries";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export default async function TargetPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireCommissionAccess();
  const { id } = await params;
  const found = await getTarget(id);
  if (!found) notFound();
  const { target: t, sales, payout } = found;

  const [people, { branches }, me] = await Promise.all([payPeople([t.employee_id]), listOrg(), getMyEmployee()]);
  const person = people.get(t.employee_id);
  const branch = branches.find((b) => b.id === person?.branch_id);
  const staffName = await staffNameLookup([t.created_by, t.closed_by, ...sales.flatMap((s) => [s.recorded_by, s.decided_by])]);

  const isOwn = me?.id === t.employee_id;
  const can = (permission: string) => Boolean(branch) && staff.permissions.hasForBranch(permission, branch!) && !isOwn;
  const canApprove = can("commission.approve");
  const canManage = can("commission.manage");
  const open = t.status === "open";
  const today = new Date().toISOString().slice(0, 10);
  const periodOver = t.period_end < today;

  const approved = sales.filter((s) => s.status === "approved").reduce((sum, s) => sum + Number(s.amount), 0);
  const pending = sales.filter((s) => s.status === "pending").reduce((sum, s) => sum + Number(s.amount), 0);
  const pendingCount = sales.filter((s) => s.status === "pending").length;
  const status = TARGET_STATUSES[t.status];
  const terms = t;

  const closeBlocker = !periodOver
    ? `The target can be closed after ${formatDate(t.period_end)}, when its period has ended.`
    : pendingCount > 0
      ? "Approve or reject the sales waiting for approval first."
      : undefined;

  return (
    <div className="max-w-5xl space-y-6">
      <p className="text-sm">
        <Link href="/hr/commissions" className="text-zinc-600 hover:underline">
          ← Commission
        </Link>
      </p>
      <PageHeader
        title={t.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>
              {person?.full_name ?? "Employee"}
              {person && ` (${person.employee_no}${branch ? `, ${branch.name}` : ""})`}
            </span>
            <span>
              · {formatDate(t.period_start)} to {formatDate(t.period_end)}
            </span>
          </span>
        }
        actions={
          canManage &&
          open && (
            <ActionButton
              action={cancelTarget.bind(null, t.id)}
              label="Cancel target"
              variant="danger"
              confirm="Cancel this target? No commission will be paid on it, and no more sales can be recorded against it."
            />
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Terms">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Target">{formatMoney(t.target_amount)}</Detail>
            <Detail label="Method">{COMMISSION_METHODS[t.method]}</Detail>
          </dl>
          <div className="mt-4 space-y-1 text-sm text-zinc-700">
            {describeTerms(terms).map((line, i) => (
              <p key={i} className={i > 0 && t.method === "tiered" ? "pl-4" : undefined}>
                {line}
              </p>
            ))}
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Set by {staffName(t.created_by)} on {formatDateTime(t.created_at)}.
          </p>
        </Card>

        <Card title={open ? "Progress" : "Result"}>
          {open || t.status === "cancelled" ? (
            <div className="space-y-4">
              <TargetProgress target={Number(t.target_amount)} approved={approved} pending={pending} />
              {open && (
                <p className="text-sm text-zinc-700">
                  Commission on approved sales so far: <span className="font-medium">{formatMoney(commissionFor(terms, approved))}</span>
                  {pending > 0 && <> ({formatMoney(commissionFor(terms, approved + pending))} if the waiting sales are approved)</>}.
                </p>
              )}
              {open && canApprove && (
                <div className="space-y-2 border-t border-zinc-100 pt-4">
                  <p className="text-sm text-zinc-600">
                    Closing totals the approved sales and works out the commission. It is paid with the next payroll, taxed
                    with the employee&apos;s salary. No more sales can be recorded after that.
                  </p>
                  <ActionButton
                    action={closeTarget.bind(null, t.id)}
                    label="Close target"
                    disabled={Boolean(closeBlocker)}
                    title={closeBlocker}
                    confirm={`Close this target? ${formatMoney(commissionFor(terms, approved))} in commission will go to the next payroll.`}
                  />
                  {closeBlocker && <p className="text-xs text-zinc-500">{closeBlocker}</p>}
                </div>
              )}
            </div>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Approved sales">{formatMoney(t.achieved)}</Detail>
              <Detail label="Commission">{formatMoney(t.commission)}</Detail>
              <Detail label="Paid">
                {Number(t.commission ?? 0) === 0 ? (
                  "No commission was earned"
                ) : payout ? (
                  <Badge tone={PAYOUT_STATUSES[payout.status].tone}>{PAYOUT_STATUSES[payout.status].label}</Badge>
                ) : (
                  "With payroll"
                )}
              </Detail>
              <Detail label="Closed">
                {formatDateTime(t.closed_at)} by {staffName(t.closed_by)}
              </Detail>
            </dl>
          )}
        </Card>
      </div>

      <Card
        title="Sales"
        actions={
          canManage && open && <SaleForm action={recordSale.bind(null, t.id)} period={{ start: t.period_start, end: t.period_end }} label="Record a sale for them" />
        }
      >
        {sales.length === 0 ? (
          <EmptyState>No sales recorded yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Client</th>
                  <th className="py-2 pr-4 text-right font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Recorded by</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => {
                  const st = SALE_STATUSES[s.status];
                  const canDecide = canApprove && open && s.status === "pending" && s.recorded_by !== staff.id;
                  const canRemove = open && s.status === "pending" && s.recorded_by === staff.id;
                  return (
                    <tr key={s.id} className="border-b border-zinc-100 align-top last:border-0">
                      <td className="whitespace-nowrap py-2 pr-4">{formatDate(s.sale_date)}</td>
                      <td className="py-2 pr-4">
                        <span className="font-medium">{s.client_name}</span>
                        {s.reference && <span className="ml-2 font-mono text-xs text-zinc-500">{s.reference}</span>}
                        {s.description && <div className="text-xs text-zinc-600">{s.description}</div>}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatMoney(s.amount)}</td>
                      <td className="py-2 pr-4 text-xs text-zinc-600">
                        {staffName(s.recorded_by)}
                        <div>{formatDateTime(s.recorded_at)}</div>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {s.decided_by && (
                          <div className="mt-1 text-xs text-zinc-600">
                            by {staffName(s.decided_by)}
                            {s.decision_note && <>: {s.decision_note}</>}
                          </div>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          {canDecide && (
                            <>
                              <ActionButton action={approveSale.bind(null, s.id, t.id)} label="Approve" />
                              <RejectSaleForm action={rejectSale.bind(null, s.id, t.id)} />
                            </>
                          )}
                          {canRemove && (
                            <ActionButton
                              action={removeSale.bind(null, s.id, t.id)}
                              label="Remove"
                              variant="danger"
                              confirm="Remove this sale? You can record it again if you need to."
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
