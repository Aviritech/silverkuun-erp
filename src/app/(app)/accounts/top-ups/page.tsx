import Link from "next/link";
import { ControlNote, StatCard, StatGrid } from "@/components/dashboard";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatDateTime, formatMoney, formatMoneyShort } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { cancelTopUp, initiateTopUp } from "@/modules/accounts/actions";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { TopUpForm } from "@/modules/accounts/components/top-up-form";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts } from "@/modules/accounts/queries";
import { TOP_UP_STATUSES, loggedStage, type TopUpRow } from "@/modules/accounts/top-ups";
import { PAYMENT_METHODS } from "@/modules/administration/constants";

const method = (m: string) => PAYMENT_METHODS[m as keyof typeof PAYMENT_METHODS] ?? m;

export default async function AccountsTopUpsPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.receipts.record");
  const supabase = await createClient();
  const [{ data, error }, banks, org] = await Promise.all([
    supabase.rpc("top_up_list", { p_statuses: null }),
    listBankAccounts(),
    listOrg(),
  ]);
  if (error) throw dbFailure(error);
  const all = data as TopUpRow[];

  // Only branches this accountant records receipts for, and their active accounts.
  const branches = org.branches.filter((b) => staff.permissions.hasForBranch("accounts.receipts.record", b));
  const branchSet = new Set(branches.map((b) => b.id));
  const bankChoices = banks.filter((b) => b.is_active && branchSet.has(b.branch_id));
  const mine = all.filter((t) => branchSet.has(t.branch_id));

  const returned = mine.filter((t) => t.status === "returned");
  const withBranch = mine.filter((t) => t.status === "with_branch");
  const logged = mine.filter((t) => t.status === "logged");
  const ready = logged.filter((t) => t.contribution_verified && !t.contribution_status);
  const history = mine.filter((t) => t.status === "logged" || t.status === "cancelled").slice(0, 30);
  const sum = (list: TopUpRow[]) => list.reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Member receipts"
        title="Member top ups"
        description="When a member's top up reaches the company, record it here and choose the branch it belongs to. That branch's officer finds the member and logs it against their plan; the Branch Manager verifies it and it comes back to you in Savings pay-ins to post."
        actions={<TopUpForm action={initiateTopUp.bind(null, null)} branches={branches} banks={bankChoices} />}
      />
      <StatGrid>
        <StatCard label="With the branch" icon="clock" value={withBranch.length} hint={`${formatMoneyShort(sum(withBranch))} waiting for an officer to log`} />
        <StatCard
          label="Sent back to you"
          icon="alert"
          tone={returned.length ? "bad" : "neutral"}
          value={returned.length}
          hint="Send to another branch, or cancel"
        />
        <StatCard label="Logged, awaiting verification" icon="check" value={logged.filter((t) => !t.contribution_verified).length} hint="Branch Manager verifies next" />
        <StatCard
          label="Ready to post"
          icon="check"
          tone={ready.length ? "good" : "neutral"}
          value={ready.length}
          hint="In Savings pay-ins"
          href="/accounts/contributions"
        />
      </StatGrid>

      {returned.length > 0 && (
        <Card title={`Sent back by the branch (${returned.length})`}>
          <div className="space-y-4">
            {returned.map((t) => (
              <div key={t.id} className="rounded-lg border border-red-200 bg-red-50/40 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    <span className="font-mono text-xs">{t.top_up_no}</span> · {t.paid_by} · {formatMoney(t.amount)}
                  </p>
                  <span className="text-xs text-zinc-500">
                    {t.branch_name} · {formatDate(t.paid_on)} · {method(t.payment_method)}
                    {t.reference && <span className="font-mono"> · {t.reference}</span>}
                  </span>
                </div>
                <p className="mt-2 text-sm">
                  <span className="font-medium">{t.decided_by_name}:</span> {t.decision_note}
                  <span className="ml-1 text-xs text-zinc-500">{formatDateTime(t.decided_at)}</span>
                </p>
                <div className="mt-3 flex flex-wrap items-start gap-3">
                  <TopUpForm
                    action={initiateTopUp.bind(null, t.id)}
                    branches={branches}
                    banks={bankChoices}
                    defaults={t}
                    openLabel="Correct and send again"
                    submitLabel="Send to branch"
                  />
                  <ReasonForm action={cancelTopUp.bind(null, t.id)} openLabel="Cancel top up" submitLabel="Cancel top up" question="Why is it being cancelled?" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={`With the branch (${withBranch.length})`}>
        {withBranch.length === 0 ? (
          <EmptyState>No top ups are waiting for a branch. Use New top up to send one.</EmptyState>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Top up</th>
                  <th className="px-5 py-2.5 font-medium">Paid by</th>
                  <th className="px-5 py-2.5 font-medium">Branch</th>
                  <th className="px-5 py-2.5 font-medium">Paid</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {withBranch.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-100 align-top last:border-0">
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs">{t.top_up_no}</span>
                      <span className="block text-xs text-zinc-500">
                        {t.requested_by_name} · {formatDateTime(t.requested_at)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {t.paid_by}
                      {t.note && <span className="block text-xs text-zinc-500">{t.note}</span>}
                    </td>
                    <td className="px-5 py-3">{t.branch_name}</td>
                    <td className="px-5 py-3">
                      {formatDate(t.paid_on)}
                      <span className="block text-xs text-zinc-500">
                        {method(t.payment_method)}
                        {t.reference && <span className="font-mono"> · {t.reference}</span>}
                        {t.bank_account_name && <> · {t.bank_account_name}</>}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatMoney(t.amount)}</td>
                    <td className="px-5 py-3">
                      <ReasonForm action={cancelTopUp.bind(null, t.id)} openLabel="Cancel" submitLabel="Cancel top up" question="Why is it being cancelled?" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ControlNote title="Who does what">
          Accounts records the money and the branch; the branch officer chooses the member and plan but can&apos;t change the amount, date or reference;
          the Branch Manager verifies; and the receipt you raise in Savings pay-ins is approved by someone else before it posts.
        </ControlNote>
      </Card>

      {history.length > 0 && (
        <Card title="Logged and cancelled">
          <ul className="divide-y divide-zinc-100 text-sm">
            {history.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="font-mono text-xs">{t.top_up_no}</span> {t.status === "logged" ? t.member_name : t.paid_by}
                  <span className="block text-xs text-zinc-500">
                    {t.branch_name} ·{" "}
                    {t.status === "logged" ? (
                      <>
                        {t.plan_name ?? "Plan"} · logged by {t.logged_by_name} · {loggedStage(t)}
                      </>
                    ) : (
                      <>
                        {t.decided_by_name}: {t.decision_note}
                      </>
                    )}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(t.amount)}</span>
                  <Badge tone={TOP_UP_STATUSES[t.status].tone}>{TOP_UP_STATUSES[t.status].label}</Badge>
                </span>
              </li>
            ))}
          </ul>
          {ready.length > 0 && (
            <p className="mt-3 text-sm">
              <Link href="/accounts/contributions" className="underline">
                Post the verified ones in Savings pay-ins
              </Link>
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
