import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { monthlyRate } from "@/lib/letters/words";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { cancelPlanRate, decidePlanRate } from "@/modules/administration/actions";
import { ApproveRateForm } from "@/modules/administration/components/forms";
import { PLAN_RATE_STAGES, PLAN_RATE_STATUSES } from "@/modules/administration/constants";
import { administrationModule } from "@/modules/administration/module";
import { listBranches, listPlanRateRequests, type PlanRateRequest } from "@/modules/administration/queries";

const PERMISSIONS = ["plans.rate.request", ...Object.values(PLAN_RATE_STAGES).map((s) => s.permission)];
const STAGE_ORDER = Object.keys(PLAN_RATE_STAGES) as (keyof typeof PLAN_RATE_STAGES)[];

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

function Steps({ r }: { r: PlanRateRequest }) {
  const done = new Map(r.approvals.map((a) => [a.stage, a]));
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STAGE_ORDER.map((stage) => {
        const a = done.get(stage);
        const current = r.stage === stage;
        return (
          <li
            key={stage}
            className={`rounded-md px-2 py-1 ring-1 ring-inset ${
              a ? "bg-green-50 text-green-900 ring-green-200" : current ? "bg-amber-50 text-amber-900 ring-amber-200" : "text-zinc-500 ring-zinc-200"
            }`}
          >
            {PLAN_RATE_STAGES[stage].label}
            {a && (
              <span className="block">
                {a.by}, {formatDate(a.at)}
                {a.note && <span className="block italic">{a.note}</span>}
              </span>
            )}
            {current && <span className="block">Waiting</span>}
          </li>
        );
      })}
    </ol>
  );
}

function RequestDetails({ r }: { r: PlanRateRequest }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Detail label="Member">
        <Link href={`/administration/members/${r.member_id}?tab=plans`} className="underline-offset-4 hover:underline">
          {r.member_name}
        </Link>
        {r.membership_no && <span className="block text-xs text-zinc-500">{r.membership_no}</span>}
      </Detail>
      <Detail label="Plan">{r.plan_name}</Detail>
      <Detail label="Rate">
        {monthlyRate(r.current_rate)}% → <strong>{monthlyRate(r.requested_rate)}% a month</strong>
      </Detail>
      <div className="sm:col-span-2">
        <Detail label="Reason">{r.reason}</Detail>
      </div>
      <Detail label="Asked by">
        {r.requested_by_name}
        <span className="block text-xs text-zinc-500">
          {formatDateTime(r.requested_at)} · {r.branch_name}
        </span>
      </Detail>
    </dl>
  );
}

export default async function SpecialRatesPage() {
  const staff = await requireModule(administrationModule);
  if (!PERMISSIONS.some((p) => staff.permissions.has(p))) notFound();

  const [all, branches] = await Promise.all([listPlanRateRequests(), listBranches()]);
  const branchOf = new Map(branches.map((b) => [b.id, b]));
  const can = (permission: string, r: PlanRateRequest) => staff.permissions.hasForBranch(permission, branchOf.get(r.branch_id)!);
  const pending = all.filter((r) => r.status === "pending");
  const mine = pending.filter((r) => r.stage && can(PLAN_RATE_STAGES[r.stage].permission, r));
  const others = pending.filter((r) => !mine.includes(r));
  const closed = all.filter((r) => r.status !== "pending");

  const renderPending = (r: PlanRateRequest, canDecide: boolean) => {
    const already = r.requested_by === staff.id || r.approvals.some((a) => a.by_id === staff.id);
    return (
      <div key={r.id} className="space-y-4 border-t border-zinc-100 pt-4 first:border-0 first:pt-0">
        <p className="font-mono text-xs">{r.request_no}</p>
        <RequestDetails r={r} />
        <Steps r={r} />
        <div className="flex flex-wrap items-start gap-3">
          {canDecide &&
            (already ? (
              <p className="text-sm text-zinc-600">You asked for or already approved this rate, so someone else must take this step.</p>
            ) : (
              <>
                <ApproveRateForm
                  action={decidePlanRate.bind(null, r.id, true)}
                  final={r.stage === "ceo"}
                />
                <ReasonForm
                  action={decidePlanRate.bind(null, r.id, false)}
                  openLabel="Decline"
                  submitLabel="Decline"
                  question="Why is this rate declined?"
                />
              </>
            ))}
          {can("plans.rate.request", r) && (
            <ReasonForm
              action={cancelPlanRate.bind(null, r.id)}
              openLabel="Cancel request"
              submitLabel="Cancel request"
              question="Why is the request cancelled?"
              variant="secondary"
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Special rates"
        description="A special rate on one member's plan. Operations asks for it from the member's Plans tab with a reason; it then needs the Branch Manager, the Head of Operations, the Regional Manager, the BDM and finally the CEO. Once the CEO approves, the plan's letters and monthly interest use the new rate."
      />

      <Card title={`Waiting for you (${mine.length})`}>
        {mine.length === 0 ? <EmptyState>Nothing is waiting for you.</EmptyState> : <div className="space-y-6">{mine.map((r) => renderPending(r, true))}</div>}
      </Card>

      <Card title={`With others (${others.length})`}>
        {others.length === 0 ? <EmptyState>Nothing else is open.</EmptyState> : <div className="space-y-6">{others.map((r) => renderPending(r, false))}</div>}
      </Card>

      <Card title="Approved and closed">
        {closed.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Request</th>
                <th className="py-1 font-medium">Member</th>
                <th className="py-1 font-medium">Rate a month</th>
                <th className="py-1 pl-4 font-medium">Status</th>
                <th className="py-1 font-medium">Closed</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100 align-top">
                  <td className="py-2">
                    <span className="font-mono text-xs">{r.request_no}</span>
                    <div className="text-xs text-zinc-500">{r.branch_name}</div>
                  </td>
                  <td className="py-2">
                    <Link href={`/administration/members/${r.member_id}?tab=plans`} className="underline-offset-4 hover:underline">
                      {r.member_name}
                    </Link>
                    <div className="text-xs text-zinc-500">{r.plan_name}</div>
                  </td>
                  <td className="py-2 tabular-nums">
                    {monthlyRate(r.current_rate)}% → {monthlyRate(r.requested_rate)}%
                  </td>
                  <td className="py-2 pl-4">
                    <Badge tone={PLAN_RATE_STATUSES[r.status].tone}>{PLAN_RATE_STATUSES[r.status].label}</Badge>
                  </td>
                  <td className="py-2 text-xs text-zinc-600">
                    {r.closed_by_name}
                    {r.closed_at && <> · {formatDate(r.closed_at)}</>}
                    {r.close_note && <div>{r.close_note}</div>}
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
