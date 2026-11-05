import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { LiquidationPayForm } from "@/modules/accounts/components/liquidation-pay-form";
import { raiseLiquidationPayment } from "@/modules/accounts/actions";
import { FINANCE_STATUSES, type FinanceStatus } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts } from "@/modules/accounts/queries";
import { returnLiquidation } from "@/modules/administration/actions";
import { listLiquidations } from "@/modules/administration/queries";

export default async function LiquidationsToPayPage() {
  const staff = await requireModule(accountsModule);
  await requirePermission("accounts.read");
  const [approved, recent, banks, org] = await Promise.all([
    listLiquidations(["approved"]),
    listLiquidations(["paid"]),
    listBankAccounts(),
    listOrg(),
  ]);
  const branches = new Map(org.branches.map((b) => [b.id, b]));
  const live = (s: string | null) => s !== null && !["rejected", "reversed"].includes(s);
  const waiting = approved.filter((l) => !live(l.payment_status));
  const inProgress = approved.filter((l) => live(l.payment_status));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Liquidations to pay"
        description="Members' savings the Branch Manager approved for payout. Check the amount and the beneficiary's account, then raise the payment; it goes through the usual approval, Internal Audit and proof of payment. When it posts, the plan closes as liquidated."
      />
      <Card title={`Waiting for a payment request (${waiting.length})`}>
        {waiting.length === 0 ? (
          <EmptyState>No approved liquidations are waiting.</EmptyState>
        ) : (
          <div className="space-y-6">
            {waiting.map((l) => {
              const branch = branches.get(l.branch_id)!;
              const canRequest = staff.permissions.hasForBranch("accounts.payments.request", branch);
              return (
                <div key={l.id} className="space-y-3 border-t border-zinc-100 pt-4 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p>
                      <span className="font-mono text-xs">{l.liquidation_no}</span> · <span className="font-medium">{l.member_name}</span>{" "}
                      <span className="text-sm text-zinc-500">
                        {l.plan_name} plan, {l.branch_name}
                      </span>
                    </p>
                    <p className="text-lg font-semibold tabular-nums">{formatMoney(l.amount)}</p>
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-zinc-500">Beneficiary account name</dt>
                      <dd>{l.beneficiary_account_name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Bank</dt>
                      <dd>
                        {l.bank_name}
                        {l.bank_code && <span className="text-xs text-zinc-500"> ({l.bank_code})</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Account number</dt>
                      <dd className="font-mono">{l.bank_account_no}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Approved by</dt>
                      <dd>
                        {l.decided_by_name} · {formatDate(l.decided_at)}
                        {l.decision_note && <span className="block text-xs text-zinc-500">{l.decision_note}</span>}
                      </dd>
                    </div>
                  </dl>
                  {Number(l.amount) !== Number(l.plan_savings) && (
                    <p className="text-xs text-amber-800">
                      Verified savings when requested were {formatMoney(l.plan_savings)}; the approved amount differs.
                    </p>
                  )}
                  {l.payment_status && (
                    <p className="text-xs text-red-700">
                      Earlier payment {l.payment_txn_no} {l.payment_status}
                    </p>
                  )}
                  {canRequest && (
                    <div className="flex flex-wrap items-start gap-3">
                      <LiquidationPayForm
                        action={raiseLiquidationPayment.bind(null, l.id)}
                        banks={banks.filter((b) => b.is_active && b.branch_id === l.branch_id)}
                      />
                      <ReasonForm
                        action={returnLiquidation.bind(null, l.id)}
                        openLabel="Send back to Operations"
                        submitLabel="Send back"
                        question="What doesn't check out (amount, beneficiary, account, documents)?"
                        variant="secondary"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <Card title={`Being paid (${inProgress.length})`}>
        {inProgress.length === 0 ? (
          <EmptyState>Nothing in progress.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {inProgress.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <span className="font-mono text-xs">{l.liquidation_no}</span> · {l.member_name} · {formatMoney(l.amount)}
                </span>
                <span className="flex items-center gap-3">
                  {l.payment_status && (
                    <Badge tone={FINANCE_STATUSES[l.payment_status as FinanceStatus].tone}>
                      {FINANCE_STATUSES[l.payment_status as FinanceStatus].label}
                    </Badge>
                  )}
                  {l.payment_txn_id && (
                    <Link href={`/accounts/transactions/${l.payment_txn_id}`} className="font-mono text-xs underline">
                      {l.payment_txn_no}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Paid">
        {recent.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {recent.slice(0, 20).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <span className="font-mono text-xs">{l.liquidation_no}</span> · {l.member_name} · {formatMoney(l.amount)}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatDate(l.paid_at)}
                  {l.payment_txn_id && (
                    <>
                      {" · "}
                      <Link href={`/accounts/transactions/${l.payment_txn_id}`} className="font-mono underline">
                        {l.payment_txn_no}
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
