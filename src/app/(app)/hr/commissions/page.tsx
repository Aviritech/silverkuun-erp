import Link from "next/link";
import { Badge, ButtonLink, EmptyState, PageHeader, Select } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { TARGET_STATUSES, type TargetStatus } from "@/modules/hr/commissions/constants";
import { TargetProgress } from "@/modules/hr/commissions/progress";
import { listTargets, payPeople, requireCommissionAccess, salesProgress } from "@/modules/hr/commissions/queries";

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ status?: string; branch?: string }> }) {
  const staff = await requireCommissionAccess();
  const { status = "open", branch = "" } = await searchParams;
  const statusFilter = status in TARGET_STATUSES ? (status as TargetStatus) : undefined;

  const [targets, { branches }] = await Promise.all([listTargets({ status: statusFilter }), listOrg()]);
  const [people, progress] = await Promise.all([payPeople(targets.map((t) => t.employee_id)), salesProgress(targets.map((t) => t.id))]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const shown = branch ? targets.filter((t) => people.get(t.employee_id)?.branch_id === branch) : targets;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Commission"
        description="Sales targets, the sales recorded against them, and the commission paid through payroll once a target closes."
        actions={staff.permissions.has("commission.manage") && <ButtonLink href="/hr/commissions/new">Set a target</ButtonLink>}
      />
      <form className="mb-4 flex flex-wrap gap-3">
        <div className="w-44">
          <Select name="status" defaultValue={statusFilter ?? "all"} aria-label="Status">
            {Object.entries(TARGET_STATUSES).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
            <option value="all">All targets</option>
          </Select>
        </div>
        <div className="w-44">
          <Select name="branch" defaultValue={branch} aria-label="Branch">
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
        {shown.length === 0 ? (
          <EmptyState>No targets match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Achieved so far</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const person = people.get(t.employee_id);
                const p = progress.get(t.id)!;
                const s = TARGET_STATUSES[t.status];
                return (
                  <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="px-4 py-2">
                      <span className="font-medium">{person?.full_name ?? "Employee"}</span>
                      <div className="text-xs text-zinc-500">
                        {person?.employee_no}
                        {person && ` · ${branchName.get(person.branch_id) ?? ""}`}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/hr/commissions/${t.id}`} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {formatDate(t.period_start)} to {formatDate(t.period_end)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(t.target_amount)}</td>
                    <td className="px-4 py-2">
                      <TargetProgress target={Number(t.target_amount)} approved={p.approved} pending={p.pending} />
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={s.tone}>{s.label}</Badge>
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
