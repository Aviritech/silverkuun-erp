import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge, ButtonLink, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { LeaveStatusBadge, leaveDates } from "@/modules/hr/leave/components/leave-views";
import { LEAVE_STATUSES, UPCOMING_DAYS, type LeaveStatus } from "@/modules/hr/leave/constants";
import { addDaysIso, todayIso, type LeaveRequest } from "@/modules/hr/leave/queries";
import { hrModule } from "@/modules/hr/module";

const PAGE_SIZE = 200;
const SELECT =
  "id, request_no, employee_id, branch_id, start_date, end_date, days, status, requested_at, employee:employees!leave_requests_employee_id_fkey(first_name, last_name, employee_no), leave_type:leave_types(name)";

type Row = Pick<LeaveRequest, "id" | "request_no" | "employee_id" | "branch_id" | "start_date" | "end_date" | "days" | "status" | "requested_at"> & {
  employee: { first_name: string; last_name: string; employee_no: string } | null;
  leave_type: { name: string } | null;
};

function monthRange(month: string): [string, string] | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}

const personName = (r: Row) => (r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : "Employee");

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; branch?: string; month?: string }>;
}) {
  const staff = await requireModule(hrModule);
  if (!staff.permissions.has("hr.read")) notFound();
  const { status = "", branch = "", month = "" } = await searchParams;
  const supabase = await createClient();
  const today = todayIso();
  const horizon = addDaysIso(UPCOMING_DAYS);

  let query = supabase.from("leave_requests").select(SELECT).order("start_date", { ascending: false }).limit(PAGE_SIZE);
  if (status in LEAVE_STATUSES) query = query.eq("status", status);
  if (branch) query = query.eq("branch_id", branch);
  const range = monthRange(month);
  // Leave that touches the month at all, not just leave that starts in it.
  if (range) query = query.lte("start_date", range[1]).gte("end_date", range[0]);

  let onLeaveQuery = supabase.from("leave_requests").select(SELECT).eq("status", "approved").lte("start_date", today).gte("end_date", today).order("end_date");
  let upcomingQuery = supabase
    .from("leave_requests")
    .select(SELECT)
    .in("status", ["approved", "pending"])
    .gt("start_date", today)
    .lte("start_date", horizon)
    .order("start_date");
  if (branch) {
    onLeaveQuery = onLeaveQuery.eq("branch_id", branch);
    upcomingQuery = upcomingQuery.eq("branch_id", branch);
  }

  const [list, onLeave, upcoming, { branches }] = await Promise.all([query, onLeaveQuery, upcomingQuery, listOrg()]);
  for (const r of [list, onLeave, upcoming]) if (r.error) throw dbFailure(r.error);
  const rows = (list.data ?? []) as unknown as Row[];
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const readableBranches = branches.filter((b) => staff.permissions.hasForBranch("hr.read", b));

  const summary = (items: Row[], empty: string, show: (r: Row) => ReactNode) =>
    items.length === 0 ? (
      <EmptyState>{empty}</EmptyState>
    ) : (
      <ul className="divide-y divide-zinc-100 text-sm">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span>
              <Link href={`/hr/leave/${r.id}`} className="font-medium hover:underline">
                {personName(r)}
              </Link>
              <span className="ml-2 text-xs text-zinc-500">
                {r.leave_type?.name} · {branchName.get(r.branch_id)}
              </span>
            </span>
            <span className="text-zinc-600">{show(r)}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Leave"
        description="Requests from every branch you look after. Each one is approved by the relief officer and then the approval chain."
        actions={
          <>
            <ButtonLink href="/hr/settings/leave" variant="secondary">
              Leave settings
            </ButtonLink>
            {staff.permissions.has("hr.manage") && <ButtonLink href="/hr/leave/new">Record leave</ButtonLink>}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`On leave today (${(onLeave.data ?? []).length})`}>
          {summary((onLeave.data ?? []) as unknown as Row[], "Nobody is on leave today.", (r) => `Back after ${formatDate(r.end_date)}`)}
        </Card>
        <Card title={`Starting in the next ${UPCOMING_DAYS} days (${(upcoming.data ?? []).length})`}>
          {summary((upcoming.data ?? []) as unknown as Row[], "No leave starts in the next two weeks.", (r) => (
            <span className="flex items-center gap-2">
              {r.status === "pending" && <Badge tone="amber">Not approved yet</Badge>}
              {formatDate(r.start_date)}
            </span>
          ))}
        </Card>
      </div>

      <div>
        <form className="mb-4 flex flex-wrap gap-3" role="search">
          <div className="w-48">
            <Select name="status" defaultValue={status} aria-label="Status">
              <option value="">Any status</option>
              {Object.entries(LEAVE_STATUSES).map(([value, s]) => (
                <option key={value} value={value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <Select name="branch" defaultValue={branch} aria-label="Branch">
              <option value="">All branches</option>
              {readableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Input name="month" type="month" defaultValue={month} aria-label="Month" />
          </div>
          <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
            Filter
          </button>
        </form>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          {rows.length === 0 ? (
            <EmptyState>No leave requests match.</EmptyState>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Request</th>
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Leave</th>
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-4 py-2 text-right font-medium">Days</th>
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="px-4 py-2">
                      <Link href={`/hr/leave/${r.id}`} className="font-mono text-xs font-medium hover:underline">
                        {r.request_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/hr/leave/${r.id}`} className="font-medium hover:underline">
                        {personName(r)}
                      </Link>
                      <div className="font-mono text-xs text-zinc-500">{r.employee?.employee_no}</div>
                    </td>
                    <td className="px-4 py-2">{r.leave_type?.name}</td>
                    <td className="whitespace-nowrap px-4 py-2">{leaveDates(r.start_date, r.end_date)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.days}</td>
                    <td className="px-4 py-2">{branchName.get(r.branch_id)}</td>
                    <td className="px-4 py-2">
                      <LeaveStatusBadge status={r.status as LeaveStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {rows.length === PAGE_SIZE && (
          <p className="mt-2 text-xs text-zinc-500">Showing the latest {PAGE_SIZE}. Filter by month or branch to narrow down.</p>
        )}
      </div>
    </div>
  );
}
