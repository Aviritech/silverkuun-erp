import { ActionButton } from "@/components/action-button";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { cancelMyLeave, requestMyLeave } from "@/modules/hr/leave/actions";
import { RequestLeaveForm } from "@/modules/hr/leave/components/forms";
import { BalancesTable, LeaveStatusBadge, leaveDates } from "@/modules/hr/leave/components/leave-views";
import {
  canCancel,
  getLeaveBalances,
  listColleagues,
  listHolidays,
  listLeaveTypes,
  stepProgress,
  stepsFor,
  todayIso,
  type LeaveRequest,
} from "@/modules/hr/leave/queries";
import { requireMyEmployee } from "@/modules/me/queries";

type MyRequest = LeaveRequest & { leave_type: { name: string } | null };

export default async function MyLeavePage() {
  const { employee } = await requireMyEmployee();
  const supabase = await createClient();
  const year = new Date().getFullYear();

  const [balances, leaveTypes, colleagues, holidays, requests] = await Promise.all([
    getLeaveBalances(employee.id, year),
    listLeaveTypes(),
    listColleagues(),
    listHolidays(year, year + 1),
    supabase
      .from("leave_requests")
      .select("*, leave_type:leave_types(name)")
      .eq("employee_id", employee.id)
      .gte("end_date", `${year}-01-01`)
      .order("start_date", { ascending: false }),
  ]);
  if (requests.error) throw dbFailure(requests.error);

  const mine = (requests.data ?? []) as MyRequest[];
  const steps = await stepsFor(mine.map((r) => r.id));
  const reliefName = new Map(colleagues.map((c) => [c.id, c.full_name]));
  const active = new Map(leaveTypes.filter((t) => t.is_active).map((t) => [t.id, t]));
  // The balances already leave out kinds of leave this employee can't take, such as paternity leave for women.
  const offered = balances
    .filter((b) => active.has(b.leave_type_id))
    .map((b) => ({
      id: b.leave_type_id,
      name: b.name,
      available: b.available,
      document_after_days: active.get(b.leave_type_id)!.document_after_days,
    }));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="My leave" description="Your leave this year, and requests waiting for approval." />

      <Card title={`Balances for ${year}`}>
        <BalancesTable balances={balances} />
        <p className="mt-3 text-xs text-zinc-500">
          Days waiting for approval already count against what is left, so the same days can&apos;t be asked for twice.
        </p>
      </Card>

      <Card title="Request leave">
        {offered.length === 0 ? (
          <EmptyState>No leave is available to you. Ask HR.</EmptyState>
        ) : (
          <RequestLeaveForm
            action={requestMyLeave}
            leaveTypes={offered}
            colleagues={colleagues.filter((c) => c.id !== employee.id)}
            holidays={holidays.map((h) => h.holiday_date)}
            minDate={todayIso()}
          />
        )}
      </Card>

      <Card title="My requests">
        {mine.length === 0 ? (
          <EmptyState>You haven&apos;t asked for any leave this year.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {mine.map((r) => {
              const relief = r.relief_employee_id ? (reliefName.get(r.relief_employee_id) ?? "your relief officer") : null;
              const progress = stepProgress(r, steps.get(r.id) ?? [], relief);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.leave_type?.name}</span>
                      <LeaveStatusBadge status={r.status} />
                      <span className="font-mono text-xs text-zinc-500">{r.request_no}</span>
                    </p>
                    <p className="text-zinc-700">
                      {leaveDates(r.start_date, r.end_date)} · {r.days} working {r.days === 1 ? "day" : "days"}
                      {relief && <span className="text-zinc-500"> · covered by {relief}</span>}
                    </p>
                    {progress && <p className="text-zinc-600">{progress}</p>}
                    {r.decision_note && <p className="text-zinc-600">Note: {r.decision_note}</p>}
                  </div>
                  {canCancel(r) && (
                    <ActionButton
                      action={cancelMyLeave.bind(null, r.id)}
                      label="Withdraw"
                      pendingLabel="Withdrawing…"
                      variant="danger"
                      confirm={`Withdraw this ${r.leave_type?.name.toLowerCase() ?? "leave"} request? The days go back on your balance.`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
