import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { approveLeaveStep, cancelLeave, decideLeave, rejectLeaveStep } from "@/modules/hr/leave/actions";
import { ApproveStepForm, CancelLeaveForm, DecideForm, RejectStepForm } from "@/modules/hr/leave/components/forms";
import { LeaveStatusBadge, StepTimeline, leaveDates } from "@/modules/hr/leave/components/leave-views";
import { canCancel, getLeaveRequest, listMyApprovals, stepProgress } from "@/modules/hr/leave/queries";
import { hrModule } from "@/modules/hr/module";
import { listDepartments, listJobTitles } from "@/modules/hr/queries";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

export default async function LeaveRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(hrModule);
  const { id } = await params;
  const bundle = await getLeaveRequest(id);
  if (!bundle) notFound();
  const { request: r, steps, reliefName, document, balance, staffName } = bundle;

  const [{ branches }, departments, jobTitles, myApprovals] = await Promise.all([
    listOrg(),
    listDepartments(),
    listJobTitles(),
    listMyApprovals(),
  ]);
  const branch = branches.find((b) => b.id === r.branch_id);
  const titleName = new Map(jobTitles.map((t) => [t.id, t.name]));
  const departmentName = new Map(departments.map((d) => [d.code, d.name]));

  const isOwn = r.employee?.staff_id === staff.id;
  const can = (permission: string) => Boolean(branch && staff.permissions.hasForBranch(permission, branch));
  const canDecide = r.status === "pending" && can("hr.approve") && !isOwn;
  const canCancelIt = canCancel(r) && can("hr.manage");
  const myStep = myApprovals.find((a) => a.request_id === r.id);
  const progress = stepProgress(r, steps, reliefName);
  const name = r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : "Employee";

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`${r.leave_type.name}: ${name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LeaveStatusBadge status={r.status} />
            <span className="font-mono text-xs">{r.request_no}</span>
            {progress && <span>{progress}</span>}
          </span>
        }
        actions={
          <Link href="/hr/leave" className="text-sm text-zinc-600 hover:underline">
            Back to leave
          </Link>
        }
      />

      {myStep && (
        <Card title={`Your decision, as ${myStep.step_name}`}>
          <div className="flex flex-wrap items-start gap-3">
            <ApproveStepForm action={approveLeaveStep.bind(null, r.id)} />
            <RejectStepForm action={rejectLeaveStep.bind(null, r.id)} />
          </div>
        </Card>
      )}

      {(canDecide || canCancelIt) && (
        <Card title="HR actions">
          <div className="space-y-3">
            {canDecide && (
              <p className="text-sm text-zinc-600">
                As Head of HR you can decide this request now, whichever step it has reached. Give the reason, for example
                that the approver is away.
              </p>
            )}
            <div className="flex flex-wrap items-start gap-3">
              {canDecide && <DecideForm action={decideLeave.bind(null, r.id, true)} approve />}
              {canDecide && <DecideForm action={decideLeave.bind(null, r.id, false)} approve={false} />}
              {canCancelIt && <CancelLeaveForm action={cancelLeave.bind(null, r.id)} />}
            </div>
          </div>
        </Card>
      )}
      {r.status === "pending" && can("hr.approve") && isOwn && (
        <p className="text-sm text-zinc-600">This is your own request, so someone else has to decide it.</p>
      )}

      <Card title="Request">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Employee">
            {r.employee ? (
              <Link href={`/hr/employees/${r.employee.id}`} className="font-medium hover:underline">
                {name}
              </Link>
            ) : null}
            {r.employee && <span className="block text-xs text-zinc-500">{titleName.get(r.employee.job_title_id)}</span>}
          </Detail>
          <Detail label="Branch and department">
            {branch?.name} · {departmentName.get(r.department_code) ?? r.department_code}
          </Detail>
          <Detail label="Leave">
            {r.leave_type.name}
            {!r.leave_type.is_paid && <span className="text-zinc-500"> (unpaid)</span>}
          </Detail>
          <Detail label="Dates">{leaveDates(r.start_date, r.end_date)}</Detail>
          <Detail label="Working days">{r.days}</Detail>
          <Detail label="Relief officer">{reliefName}</Detail>
          <Detail label="Reason">{r.reason}</Detail>
          <Detail label="Supporting document">
            {document &&
              (document.url ? (
                <a href={document.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                  {document.fileName}
                </a>
              ) : (
                document.fileName
              ))}
          </Detail>
          <Detail label="Asked for">
            {staffName(r.requested_by)}, {formatDateTime(r.requested_at)}
          </Detail>
          {r.decided_at && <Detail label="Decided">{formatDateTime(r.decided_at)}</Detail>}
          {r.cancelled_at && <Detail label="Cancelled">{formatDateTime(r.cancelled_at)}</Detail>}
          {r.decision_note && (
            <div className="sm:col-span-3">
              <Detail label="Decision note">{r.decision_note}</Detail>
            </div>
          )}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Approval steps">
          <StepTimeline steps={steps} staffName={staffName} reliefName={reliefName} jobTitleName={titleName} />
        </Card>
        <Card title={`${r.leave_type.name} in ${r.start_date.slice(0, 4)}`}>
          {balance ? (
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="Days this year">{balance.uses_balance ? balance.entitlement : "No limit"}</Detail>
              <Detail label="Taken">{balance.taken}</Detail>
              <Detail label="Waiting for approval">{balance.pending}</Detail>
              <Detail label="Left">{balance.available ?? "No limit"}</Detail>
            </dl>
          ) : (
            <p className="text-sm text-zinc-500">The balance isn&apos;t available.</p>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            Days waiting for approval, including this request while it is pending, already count against what is left.
          </p>
        </Card>
      </div>
    </div>
  );
}
