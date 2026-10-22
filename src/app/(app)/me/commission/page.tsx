import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { staffNameLookup } from "@/modules/accounts/queries";
import { recordSale, removeSale } from "@/modules/hr/commissions/actions";
import { PAYOUT_STATUSES, SALE_STATUSES, commissionFor, describeTerms } from "@/modules/hr/commissions/constants";
import { SaleForm } from "@/modules/hr/commissions/forms";
import { TargetProgress } from "@/modules/hr/commissions/progress";
import { getTarget, listTargets, payoutsFor } from "@/modules/hr/commissions/queries";
import { requireMyEmployee } from "@/modules/me/queries";

export default async function MyCommissionPage() {
  const { staff, employee } = await requireMyEmployee();
  const targets = await listTargets({ employeeId: employee.id });
  const open = targets.filter((t) => t.status === "open");
  const closed = targets.filter((t) => t.status === "closed");

  const [openDetails, payouts] = await Promise.all([
    Promise.all(open.map((t) => getTarget(t.id))),
    payoutsFor(closed.map((t) => t.payout_id)),
  ]);
  const staffName = await staffNameLookup(openDetails.flatMap((d) => d?.sales.map((s) => s.decided_by) ?? []));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="My commission"
        description="Record your sales against your targets. A sale counts once someone else approves it. When a target closes, the commission is paid with your next salary."
      />

      {open.length === 0 && <EmptyState>You have no open commission targets.</EmptyState>}

      {openDetails.map((d) => {
        if (!d) return null;
        const { target: t, sales } = d;
        const approved = sales.filter((s) => s.status === "approved").reduce((sum, s) => sum + Number(s.amount), 0);
        const pending = sales.filter((s) => s.status === "pending").reduce((sum, s) => sum + Number(s.amount), 0);
        const canRecord = t.period_start <= today;
        return (
          <Card
            key={t.id}
            title={`${t.name} · ${formatDate(t.period_start)} to ${formatDate(t.period_end)}`}
            actions={canRecord && <SaleForm action={recordSale.bind(null, t.id)} period={{ start: t.period_start, end: t.period_end }} />}
          >
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-1 text-sm text-zinc-700">
                <p className="font-medium text-ink">Target: {formatMoney(t.target_amount)}</p>
                {describeTerms(t).map((line, i) => (
                  <p key={i} className={i > 0 && t.method === "tiered" ? "pl-4" : undefined}>
                    {line}
                  </p>
                ))}
              </div>
              <div className="space-y-2">
                <TargetProgress target={Number(t.target_amount)} approved={approved} pending={pending} />
                <p className="text-sm text-zinc-700">
                  Commission so far: <span className="font-medium">{formatMoney(commissionFor(t, approved))}</span>
                  {pending > 0 && <> ({formatMoney(commissionFor(t, approved + pending))} if your waiting sales are approved)</>}
                </p>
                {!canRecord && <p className="text-xs text-zinc-500">You can record sales from {formatDate(t.period_start)}.</p>}
              </div>
            </div>

            {sales.length > 0 && (
              <div className="mt-5 overflow-x-auto border-t border-zinc-100 pt-3">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium">Client</th>
                      <th className="py-2 pr-4 text-right font-medium">Amount</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id} className="border-t border-zinc-100 align-top">
                        <td className="whitespace-nowrap py-2 pr-4">{formatDate(s.sale_date)}</td>
                        <td className="py-2 pr-4">
                          {s.client_name}
                          {s.reference && <span className="ml-2 font-mono text-xs text-zinc-500">{s.reference}</span>}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatMoney(s.amount)}</td>
                        <td className="py-2 pr-4">
                          <Badge tone={SALE_STATUSES[s.status].tone}>{SALE_STATUSES[s.status].label}</Badge>
                          {s.status === "rejected" && (
                            <div className="mt-1 text-xs text-zinc-600">
                              {staffName(s.decided_by)}: {s.decision_note}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {s.status === "pending" && s.recorded_by === staff.id && (
                            <ActionButton
                              action={removeSale.bind(null, s.id, t.id)}
                              label="Remove"
                              variant="danger"
                              confirm="Remove this sale? You can record it again if you need to."
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}

      <Card title="Closed targets">
        {closed.length === 0 ? (
          <EmptyState>No closed targets yet.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Target</th>
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 text-right font-medium">Target amount</th>
                <th className="py-2 pr-4 text-right font-medium">Approved sales</th>
                <th className="py-2 pr-4 text-right font-medium">Commission</th>
                <th className="py-2 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((t) => {
                const payout = t.payout_id ? payouts.get(t.payout_id) : undefined;
                return (
                  <tr key={t.id} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 pr-4 font-medium">{t.name}</td>
                    <td className="whitespace-nowrap py-2 pr-4">
                      {formatDate(t.period_start)} to {formatDate(t.period_end)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(t.target_amount)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(t.achieved)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(t.commission)}</td>
                    <td className="py-2">
                      {Number(t.commission ?? 0) === 0 ? (
                        <span className="text-zinc-500">Nothing to pay</span>
                      ) : payout ? (
                        <Badge tone={PAYOUT_STATUSES[payout.status].tone}>{PAYOUT_STATUSES[payout.status].label}</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
