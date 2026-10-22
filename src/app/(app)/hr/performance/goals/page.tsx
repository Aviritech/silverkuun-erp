import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { hrModule } from "@/modules/hr/module";
import { cancelGoal, setGoal, updateGoalProgress } from "@/modules/hr/performance/actions";
import { GoalForm, ProgressForm } from "@/modules/hr/performance/components";
import { GOAL_STATUSES, GOAL_TYPES, type GoalStatus } from "@/modules/hr/performance/constants";
import { isOverdue, listGoals, listPerformancePeople, staffNames } from "@/modules/hr/performance/queries";

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ status?: string; branch?: string }> }) {
  const staff = await requireModule(hrModule);
  if (!staff.permissions.has("performance.read") && !staff.permissions.has("performance.review")) notFound();
  const { status = "open", branch } = await searchParams;
  const statusFilter = status in GOAL_STATUSES ? (status as GoalStatus) : undefined;

  const [people, { branches: allBranches }] = await Promise.all([listPerformancePeople(), listOrg()]);
  const branches = allBranches.filter(
    (b) => staff.permissions.hasForBranch("performance.read", b) || staff.permissions.hasForBranch("performance.review", b),
  );
  const branchFilter = branches.find((b) => b.id === branch)?.id;
  const goals = await listGoals({
    status: statusFilter,
    employeeIds: branchFilter ? people.filter((p) => p.branch_id === branchFilter).map((p) => p.id) : undefined,
  });
  const setters = await staffNames(goals.map((g) => g.set_by));
  const person = new Map(people.map((p) => [p.id, p]));
  const branchById = new Map(allBranches.map((b) => [b.id, b]));
  const canReviewIn = (branchId: string | undefined) => {
    const b = branchId ? branchById.get(branchId) : undefined;
    return !!b && staff.permissions.hasForBranch("performance.review", b);
  };

  const goalPeople = people
    .filter((p) => !p.is_me && (p.status === "probation" || p.status === "active") && canReviewIn(p.branch_id))
    .map((p) => ({ id: p.id, label: `${p.full_name} (${p.employee_no}), ${branchById.get(p.branch_id)?.name ?? ""}` }));

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Goals"
        description="Goals set for staff by their reviewers. The employee or the reviewer records progress; 100% completes a goal."
        actions={
          <ButtonLink href="/hr/performance" variant="secondary">
            Reviews
          </ButtonLink>
        }
      />
      {staff.permissions.has("performance.review") && goalPeople.length > 0 && <GoalForm action={setGoal} people={goalPeople} />}

      <form className="flex flex-wrap gap-3" role="search">
        <div className="w-44">
          <Select name="status" defaultValue={statusFilter ?? "all"} aria-label="Status">
            {Object.entries(GOAL_STATUSES).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
            <option value="all">All goals</option>
          </Select>
        </div>
        <div className="w-48">
          <Select name="branch" defaultValue={branchFilter ?? ""} aria-label="Branch">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {goals.length === 0 ? (
          <EmptyState>No goals match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Goal</th>
                <th className="px-4 py-2 font-medium">Target date</th>
                <th className="px-4 py-2 font-medium">Progress</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {goals.map((g) => {
                const p = person.get(g.employee_id);
                const overdue = isOverdue(g);
                const s = GOAL_STATUSES[g.status];
                const canChange = g.status === "open" && canReviewIn(p?.branch_id) && !p?.is_me;
                return (
                  <tr key={g.id} className="border-b border-zinc-100 align-top last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-medium">{p?.full_name ?? "Employee"}</span>
                      {p && <div className="text-xs text-zinc-500">{branchById.get(p.branch_id)?.name}</div>}
                    </td>
                    <td className="max-w-sm px-4 py-2">
                      <span className="font-medium">{g.title}</span>
                      <div className="text-xs text-zinc-500">
                        {GOAL_TYPES[g.goal_type]} · set by {g.set_by === staff.id ? "you" : (setters.get(g.set_by) ?? "—")}
                      </div>
                      {g.description && <p className="mt-1 text-xs text-zinc-600">{g.description}</p>}
                      {g.progress_note && <p className="mt-1 text-xs text-zinc-600">Latest: {g.progress_note}</p>}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-2 ${overdue ? "font-medium text-red-700" : ""}`}>
                      {formatDate(g.target_date)}
                      {overdue && <div className="text-xs">Overdue</div>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-zinc-100">
                          <div className="h-full bg-ink" style={{ width: `${g.progress}%` }} />
                        </div>
                        <span className="tabular-nums">{g.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      {canChange && (
                        <div className="flex flex-wrap items-start gap-2">
                          <ProgressForm action={updateGoalProgress.bind(null, g.id)} progress={g.progress} />
                          <ActionButton
                            action={cancelGoal.bind(null, g.id)}
                            label="Cancel goal"
                            variant="secondary"
                            confirm={`Cancel the goal "${g.title}"? It can't be reopened.`}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
