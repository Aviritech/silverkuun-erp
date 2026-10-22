import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { hrModule } from "@/modules/hr/module";
import { startReview } from "@/modules/hr/performance/actions";
import { NewReviewForm } from "@/modules/hr/performance/components";
import { REVIEW_STATUSES, type ReviewStatus } from "@/modules/hr/performance/constants";
import { listPerformancePeople, listReviews, staffNames } from "@/modules/hr/performance/queries";
import { ScoreBadge } from "@/modules/hr/performance/review-view";

export default async function PerformanceReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string; branch?: string }> }) {
  const staff = await requireModule(hrModule);
  if (!staff.permissions.has("performance.read") && !staff.permissions.has("performance.review")) notFound();
  const { status, branch } = await searchParams;
  const statusFilter = status && status in REVIEW_STATUSES ? (status as ReviewStatus) : undefined;

  const [people, { branches: allBranches }] = await Promise.all([listPerformancePeople(), listOrg()]);
  const branches = allBranches.filter(
    (b) => staff.permissions.hasForBranch("performance.read", b) || staff.permissions.hasForBranch("performance.review", b),
  );
  const branchFilter = branches.find((b) => b.id === branch)?.id;
  const reviews = await listReviews({
    status: statusFilter,
    employeeIds: branchFilter ? people.filter((p) => p.branch_id === branchFilter).map((p) => p.id) : undefined,
  });
  const reviewers = await staffNames(reviews.map((r) => r.reviewer_id));
  const person = new Map(people.map((p) => [p.id, p]));
  const branchName = new Map(allBranches.map((b) => [b.id, b.name]));

  const reviewable = people
    .filter((p) => !p.is_me && (p.status === "probation" || p.status === "active"))
    .filter((p) => {
      const b = allBranches.find((x) => x.id === p.branch_id);
      return b && staff.permissions.hasForBranch("performance.review", b);
    })
    .map((p) => ({ id: p.id, label: `${p.full_name} (${p.employee_no}), ${branchName.get(p.branch_id) ?? ""}` }));

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Performance reviews"
        description="Reviews are drafted by the employee's branch or department head, then submitted for the employee to acknowledge."
        actions={
          <ButtonLink href="/hr/performance/goals" variant="secondary">
            Goals
          </ButtonLink>
        }
      />
      {staff.permissions.has("performance.review") &&
        (reviewable.length > 0 ? (
          <NewReviewForm action={startReview} people={reviewable} />
        ) : (
          <p className="text-sm text-zinc-600">There is nobody in your branches for you to review.</p>
        ))}

      <form className="flex flex-wrap gap-3" role="search">
        <div className="w-56">
          <Select name="status" defaultValue={statusFilter ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(REVIEW_STATUSES).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
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
        {reviews.length === 0 ? (
          <EmptyState>No reviews match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 font-medium">Reviewer</th>
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const p = person.get(r.employee_id);
                const s = REVIEW_STATUSES[r.status];
                return (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="px-4 py-2">
                      <Link href={`/hr/performance/${r.id}`} className="font-medium hover:underline">
                        {p?.full_name ?? "Employee"}
                      </Link>
                      {p && <div className="text-xs text-zinc-500">{branchName.get(p.branch_id)}</div>}
                    </td>
                    <td className="px-4 py-2">
                      {r.period_label}
                      <div className="text-xs text-zinc-500">
                        {formatDate(r.period_start)} to {formatDate(r.period_end)}
                      </div>
                    </td>
                    <td className="px-4 py-2">{r.reviewer_id === staff.id ? "You" : (reviewers.get(r.reviewer_id) ?? "—")}</td>
                    <td className="px-4 py-2">
                      <ScoreBadge score={r.overall_score} />
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
