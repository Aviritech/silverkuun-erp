import type { ReactNode } from "react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getCurrentStaff } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { approveLeaveStep, rejectLeaveStep } from "@/modules/hr/leave/actions";
import { ApproveStepForm, RejectStepForm } from "@/modules/hr/leave/components/forms";
import { leaveDates } from "@/modules/hr/leave/components/leave-views";
import { getLeaveBalances, listMyApprovals, type PendingApproval } from "@/modules/hr/leave/queries";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

function actingAs(a: PendingApproval): string {
  if (a.step_kind === "relief") return "You were chosen as relief officer. Approve if you agree to cover their work.";
  if (a.step_kind === "hr") return "As Head of HR: nobody in the approval chain could approve this request.";
  return `As ${a.step_name}.`;
}

export default async function MyApprovalsPage() {
  // Not limited to employees: the Head of HR's step needs only the permission.
  await getCurrentStaff();
  const approvals = await listMyApprovals();

  // Each person's balance for the year their leave falls in, fetched once per person and year.
  const keys = [...new Set(approvals.map((a) => `${a.employee_id}:${a.start_date.slice(0, 4)}`))];
  const balances = new Map(
    await Promise.all(
      keys.map(async (key) => {
        const [employeeId, year] = key.split(":") as [string, string];
        return [key, await getLeaveBalances(employeeId, Number(year))] as const;
      }),
    ),
  );

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Approvals"
        description="Leave requests waiting for you. Once you approve, the request moves to the next step; turning it down ends it."
      />
      {approvals.length === 0 ? (
        <Card>
          <EmptyState>Nothing is waiting for you.</EmptyState>
        </Card>
      ) : (
        approvals.map((a) => {
          const balance = balances.get(`${a.employee_id}:${a.start_date.slice(0, 4)}`)?.find((b) => b.name === a.leave_type);
          return (
            <Card key={a.request_id} title={`${a.employee_name}: ${a.leave_type}`}>
              <p className="mb-4 text-sm text-zinc-700">{actingAs(a)}</p>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Detail label="Job title and branch">
                  {a.job_title}, {a.branch_name}
                </Detail>
                <Detail label="Dates">{leaveDates(a.start_date, a.end_date)}</Detail>
                <Detail label="Working days">{a.days}</Detail>
                <Detail label="Relief officer">{a.relief_name}</Detail>
                <Detail label={`${a.leave_type} left in ${a.start_date.slice(0, 4)}`}>
                  {balance
                    ? balance.available === null
                      ? "No limit"
                      : `${balance.available} days, after this request`
                    : null}
                </Detail>
                <Detail label="Asked for">
                  <span className="font-mono text-xs">{a.request_no}</span> · {formatDateTime(a.requested_at)}
                </Detail>
                <div className="sm:col-span-3">
                  <Detail label="Reason">{a.reason}</Detail>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-zinc-100 pt-4">
                <ApproveStepForm action={approveLeaveStep.bind(null, a.request_id)} />
                <RejectStepForm action={rejectLeaveStep.bind(null, a.request_id)} />
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
