import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { cancelLiquidation, decideLiquidation, requestLiquidation, returnLiquidation } from "@/modules/administration/actions";
import { ApproveLiquidationForm, LiquidationForm } from "@/modules/administration/components/liquidation-form";
import { LIQUIDATION_STATUSES } from "@/modules/administration/constants";
import { administrationModule } from "@/modules/administration/module";
import { listBranches, listCbnBanks, listLiquidations, type Liquidation } from "@/modules/administration/queries";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

function LiquidationDetails({ l }: { l: Liquidation }) {
  const early = l.maturity_date > new Date().toISOString().slice(0, 10);
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Detail label="Member">
        <Link href={`/administration/members/${l.member_id}?tab=plans`} className="underline-offset-4 hover:underline">
          {l.member_name}
        </Link>
        {l.membership_no && <span className="block text-xs text-zinc-500">{l.membership_no}</span>}
      </Detail>
      <Detail label="Plan">
        {l.plan_name} · {formatDate(l.start_date)} to {formatDate(l.maturity_date)}
        {early && <span className="block text-xs text-amber-800">Early: the plan hasn&apos;t matured yet</span>}
      </Detail>
      <Detail label="Amount to pay">
        {formatMoney(l.amount)}
        <span className="block text-xs text-zinc-500">Verified savings when requested: {formatMoney(l.plan_savings)}</span>
      </Detail>
      <Detail label="Beneficiary account name">{l.beneficiary_account_name}</Detail>
      <Detail label="Bank">
        {l.bank_name}
        {l.bank_code && <span className="text-xs text-zinc-500"> ({l.bank_code})</span>}
      </Detail>
      <Detail label="Account number">
        <span className="font-mono">{l.bank_account_no}</span>
      </Detail>
      <Detail label="Requested by">
        {l.requested_by_name}
        <span className="block text-xs text-zinc-500">{formatDateTime(l.requested_at)}</span>
      </Detail>
      <Detail label="Branch">{l.branch_name}</Detail>
      <Detail label="Note">{l.note}</Detail>
    </dl>
  );
}

export default async function LiquidationsPage() {
  const staff = await requireModule(administrationModule);
  if (!staff.permissions.has("liquidations.request") && !staff.permissions.has("liquidations.approve")) notFound();

  const [all, branches, banks] = await Promise.all([listLiquidations(), listBranches(), listCbnBanks()]);
  const branchOf = new Map(branches.map((b) => [b.id, b]));
  const can = (permission: string, l: Liquidation) => staff.permissions.hasForBranch(permission, branchOf.get(l.branch_id)!);
  const pending = all.filter((l) => l.status === "pending_approval");
  const returned = all.filter((l) => l.status === "returned");
  const rest = all.filter((l) => !["pending_approval", "returned"].includes(l.status));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Liquidations"
        description="Members paying out their savings at the end of a plan. Operations raises the request from the member's Plans tab with the account to pay into; the Branch Manager approves it; Accounts then pays it, and the plan closes when the payment posts."
      />

      <Card title={`Waiting for the Branch Manager (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>Nothing is waiting.</EmptyState>
        ) : (
          <div className="space-y-6">
            {pending.map((l) => (
              <div key={l.id} className="space-y-4 border-t border-zinc-100 pt-4 first:border-0 first:pt-0">
                <p className="font-mono text-xs">{l.liquidation_no}</p>
                <LiquidationDetails l={l} />
                {can("liquidations.approve", l) &&
                  (l.requested_by === staff.id ? (
                    <p className="text-sm text-zinc-600">You raised this request, so someone else must approve it.</p>
                  ) : (
                    <div className="flex flex-wrap items-start gap-3">
                      <ApproveLiquidationForm action={decideLiquidation.bind(null, l.id, true)} />
                      <ReasonForm
                        action={returnLiquidation.bind(null, l.id)}
                        openLabel="Send back to the officer"
                        submitLabel="Send back"
                        question="What needs correcting?"
                        variant="secondary"
                      />
                      <ReasonForm
                        action={decideLiquidation.bind(null, l.id, false)}
                        openLabel="Reject"
                        submitLabel="Reject"
                        question="Why is this request rejected?"
                      />
                    </div>
                  ))}
                {can("liquidations.request", l) && (
                  <ReasonForm
                    action={cancelLiquidation.bind(null, l.id)}
                    openLabel="Cancel request"
                    submitLabel="Cancel request"
                    question="Why is the request cancelled?"
                    variant="secondary"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Sent back for correction (${returned.length})`}>
        {returned.length === 0 ? (
          <EmptyState>Nothing was sent back.</EmptyState>
        ) : (
          <div className="space-y-6">
            {returned.map((l) => (
              <div key={l.id} className="space-y-4 border-t border-zinc-100 pt-4 first:border-0 first:pt-0">
                <p className="font-mono text-xs">{l.liquidation_no}</p>
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
                  {l.decision_note} <span className="text-xs">({l.decided_by_name}, {formatDateTime(l.decided_at)})</span>
                </p>
                <LiquidationDetails l={l} />
                {can("liquidations.request", l) && (
                  <div className="flex flex-wrap items-start gap-3">
                    <LiquidationForm
                      action={requestLiquidation.bind(null, null, l.id)}
                      banks={banks}
                      savings={l.plan_savings}
                      defaults={l}
                      openLabel="Correct and send again"
                    />
                    <ReasonForm
                      action={cancelLiquidation.bind(null, l.id)}
                      openLabel="Cancel request"
                      submitLabel="Cancel request"
                      question="Why is the request cancelled?"
                      variant="secondary"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Approved and closed">
        {rest.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Request</th>
                <th className="py-1 font-medium">Member</th>
                <th className="py-1 text-right font-medium">Amount</th>
                <th className="py-1 pl-4 font-medium">Status</th>
                <th className="py-1 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rest.map((l) => (
                <tr key={l.id} className="border-t border-zinc-100 align-top">
                  <td className="py-2">
                    <span className="font-mono text-xs">{l.liquidation_no}</span>
                    <div className="text-xs text-zinc-500">{l.branch_name}</div>
                  </td>
                  <td className="py-2">
                    {l.member_name}
                    <div className="text-xs text-zinc-500">{l.plan_name}</div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(l.amount)}</td>
                  <td className="py-2 pl-4">
                    <Badge tone={LIQUIDATION_STATUSES[l.status].tone}>{LIQUIDATION_STATUSES[l.status].label}</Badge>
                    {l.payment_txn_no && <div className="mt-1 font-mono text-xs text-zinc-500">{l.payment_txn_no} {l.payment_status}</div>}
                  </td>
                  <td className="py-2 text-xs text-zinc-600">
                    {l.decided_by_name}
                    {l.decided_at && <> · {formatDate(l.decided_at)}</>}
                    {l.decision_note && <div>{l.decision_note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
