import Link from "next/link";
import { notFound } from "next/navigation";
import { StatCard, StatGrid } from "@/components/dashboard";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatDateTime, formatMoney, formatMoneyShort } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { TOP_UP_STATUSES, loggedStage, type TopUpRow } from "@/modules/accounts/top-ups";
import { logTopUp, returnTopUp } from "@/modules/administration/actions";
import { PAYMENT_METHODS } from "@/modules/administration/constants";
import { LogTopUpForm, type PlanOption } from "@/modules/administration/components/top-up-forms";
import { administrationModule } from "@/modules/administration/module";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

type MemberWithPlans = {
  id: string;
  branch_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  membership_no: string | null;
  member_plans: { id: string; status: string; start_date: string; plan_types: { name: string } | null }[];
};

export default async function TopUpsFromAccountsPage() {
  const staff = await requireModule(administrationModule);
  if (!staff.permissions.has("members.read")) notFound();
  const canLog = staff.permissions.has("contributions.record");

  const supabase = await createClient();
  const [waitingRes, recentRes] = await Promise.all([
    supabase.rpc("top_up_list", { p_statuses: ["with_branch"] }),
    supabase.rpc("top_up_list", { p_statuses: ["logged", "returned"] }).limit(20),
  ]);
  if (waitingRes.error) throw dbFailure(waitingRes.error);
  if (recentRes.error) throw dbFailure(recentRes.error);
  const waiting = (waitingRes.data as TopUpRow[]).slice().reverse();
  const recent = recentRes.data as TopUpRow[];

  // Active plans in the branches with top ups waiting, for the officer to choose from.
  const plansByBranch = new Map<string, PlanOption[]>();
  const branchIds = [...new Set(waiting.map((t) => t.branch_id))];
  if (canLog && branchIds.length) {
    const { data, error } = await supabase
      .from("members")
      .select("id, branch_id, first_name, middle_name, last_name, membership_no, member_plans(id, status, start_date, plan_types(name))")
      .in("branch_id", branchIds)
      .eq("status", "approved")
      .order("last_name")
      .limit(5000);
    if (error) throw dbFailure(error);
    for (const m of data as unknown as MemberWithPlans[]) {
      const name = [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ");
      for (const p of m.member_plans.filter((p) => p.status === "active")) {
        const list = plansByBranch.get(m.branch_id) ?? [];
        list.push({
          id: p.id,
          label: `${name}${m.membership_no ? ` (${m.membership_no})` : ""} · ${p.plan_types?.name ?? "Plan"} from ${formatDate(p.start_date)}`,
          search: `${name} ${m.membership_no ?? ""}`.toLowerCase(),
        });
        plansByBranch.set(m.branch_id, list);
      }
    }
  }
  const total = waiting.reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Member money"
        title="Top ups from Accounts"
        description="Accounts records each top up it receives and sends it to the member's branch. Find the member and log it against their plan, or send it back if it isn't one of your members. Logged top ups go to the Branch Manager to verify, then to Accounts to post."
      />
      <StatGrid>
        <StatCard label="Waiting to be logged" icon="clock" tone={waiting.length ? "warn" : "neutral"} value={waiting.length} hint={`${formatMoneyShort(total)} in total`} />
        <StatCard
          label="Logged, awaiting verification"
          icon="check"
          value={recent.filter((t) => t.status === "logged" && !t.contribution_verified).length}
          hint="Branch Manager verifies on the member's plan"
        />
        <StatCard label="Sent back to Accounts" icon="alert" value={recent.filter((t) => t.status === "returned").length} hint="Recently" />
      </StatGrid>

      {waiting.length === 0 && (
        <Card>
          <EmptyState>Nothing is waiting. Top ups Accounts sends to your branch appear here.</EmptyState>
        </Card>
      )}
      {waiting.map((t) => (
        <Card key={t.id} title={`${t.top_up_no} · ${formatMoney(t.amount)}`}>
          <dl className="grid gap-4 sm:grid-cols-4">
            <Detail label="Paid by">{t.paid_by}</Detail>
            <Detail label="Date paid">{formatDate(t.paid_on)}</Detail>
            <Detail label="How">
              {PAYMENT_METHODS[t.payment_method as keyof typeof PAYMENT_METHODS] ?? t.payment_method}
              {t.reference && <span className="block font-mono text-xs text-zinc-500">{t.reference}</span>}
            </Detail>
            <Detail label="Branch">{t.branch_name}</Detail>
            <Detail label="Paid into">{t.bank_account_name}</Detail>
            <Detail label="Sent by">
              {t.requested_by_name}
              <span className="block text-xs text-zinc-500">{formatDateTime(t.requested_at)}</span>
            </Detail>
            <div className="sm:col-span-2">
              <Detail label="Note from Accounts">{t.note}</Detail>
            </div>
          </dl>
          {canLog ? (
            <div className="mt-4 flex flex-wrap items-start gap-3">
              <LogTopUpForm action={logTopUp.bind(null, t.id)} plans={plansByBranch.get(t.branch_id) ?? []} paidBy={t.paid_by} />
              <ReasonForm
                action={returnTopUp.bind(null, t.id)}
                openLabel="Not our member"
                submitLabel="Send back to Accounts"
                question="Why can't the branch log it?"
                variant="secondary"
              />
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-600">The branch officer logs this against the member.</p>
          )}
        </Card>
      ))}

      {recent.length > 0 && (
        <Card title="Recently handled">
          <ul className="divide-y divide-zinc-100 text-sm">
            {recent.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="font-mono text-xs">{t.top_up_no}</span>{" "}
                  {t.member_id ? (
                    <Link href={`/administration/members/${t.member_id}?tab=plans`} className="underline-offset-4 hover:underline">
                      {t.member_name}
                    </Link>
                  ) : (
                    t.paid_by
                  )}
                  <span className="block text-xs text-zinc-500">
                    {t.status === "logged"
                      ? `${t.plan_name ?? "Plan"} · logged by ${t.logged_by_name} · ${loggedStage(t)}`
                      : `${t.decided_by_name}: ${t.decision_note}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(t.amount)}</span>
                  <Badge tone={TOP_UP_STATUSES[t.status].tone}>{TOP_UP_STATUSES[t.status].label}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
