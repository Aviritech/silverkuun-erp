import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { acknowledgeReview, updateMyGoalProgress } from "@/modules/hr/performance/actions";
import { AcknowledgeForm, ProgressForm } from "@/modules/hr/performance/components";
import { GOAL_STATUSES, GOAL_TYPES, REVIEW_STATUSES } from "@/modules/hr/performance/constants";
import { getMyPerformance, isOverdue, listReviewScores, staffNames } from "@/modules/hr/performance/queries";
import { ScoreBadge, ScoresTable, TextBlock } from "@/modules/hr/performance/review-view";
import { requireMyEmployee } from "@/modules/me/queries";

export default async function MyPerformancePage() {
  const { employee } = await requireMyEmployee();
  const { reviews, goals } = await getMyPerformance(employee.id);
  const [scores, names] = await Promise.all([
    listReviewScores(reviews.map((r) => r.id)),
    staffNames([...reviews.map((r) => r.reviewer_id), ...goals.map((g) => g.set_by)]),
  ]);
  const openGoals = goals.filter((g) => g.status === "open");
  const closedGoals = goals.filter((g) => g.status !== "open");

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="My performance" description="Your reviews and the goals your manager has set for you." />

      <Card title="Goals">
        {goals.length === 0 ? (
          <EmptyState>No goals have been set for you yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {[...openGoals, ...closedGoals].map((g) => {
              const overdue = isOverdue(g);
              const s = GOAL_STATUSES[g.status];
              return (
                <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{g.title}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </p>
                    <p className="text-xs text-zinc-500">
                      {GOAL_TYPES[g.goal_type]} · set by {names.get(g.set_by) ?? "your manager"}
                      {g.target_date && (
                        <span className={overdue ? "font-medium text-red-700" : ""}>
                          {" "}
                          · {overdue ? "overdue since" : "by"} {formatDate(g.target_date)}
                        </span>
                      )}
                    </p>
                    {g.description && <p className="mt-1 text-zinc-600">{g.description}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-zinc-100">
                        <div className="h-full bg-ink" style={{ width: `${g.progress}%` }} />
                      </div>
                      <span className="tabular-nums">{g.progress}%</span>
                      {g.progress_note && <span className="text-xs text-zinc-500">{g.progress_note}</span>}
                    </div>
                  </div>
                  {g.status === "open" && <ProgressForm action={updateMyGoalProgress.bind(null, g.id)} progress={g.progress} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {reviews.length === 0 ? (
        <Card title="Reviews">
          <EmptyState>You have no reviews yet. They appear here once your reviewer submits them.</EmptyState>
        </Card>
      ) : (
        reviews.map((r) => {
          const s = REVIEW_STATUSES[r.status];
          return (
            <Card
              key={r.id}
              title={`Review: ${r.period_label}`}
              actions={<Badge tone={r.status === "submitted" ? "amber" : s.tone}>{r.status === "submitted" ? "Please acknowledge" : s.label}</Badge>}
            >
              <div className="space-y-5">
                <p className="text-sm text-zinc-600">
                  {formatDate(r.period_start)} to {formatDate(r.period_end)} · reviewed by {names.get(r.reviewer_id) ?? "your manager"} · submitted{" "}
                  {formatDate(r.submitted_at)}
                </p>
                <ScoresTable scores={scores.get(r.id) ?? []} />
                <p className="flex items-center gap-2 text-sm">
                  <span className="text-zinc-600">Overall score:</span>
                  <ScoreBadge score={r.overall_score} />
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextBlock label="Strengths" text={r.strengths} />
                  <TextBlock label="Areas to improve" text={r.improvements} />
                  <TextBlock label="Reviewer's comments" text={r.reviewer_comments} />
                  <TextBlock label="Next review" text={r.next_review_date && formatDate(r.next_review_date)} />
                </div>
                {r.status === "submitted" ? (
                  <div className="space-y-2">
                    <p className="text-sm text-zinc-700">Acknowledge that you have read this review. You can add your own comments.</p>
                    <AcknowledgeForm action={acknowledgeReview.bind(null, r.id)} />
                  </div>
                ) : (
                  <div className="space-y-1 rounded-lg bg-zinc-50 p-3">
                    <TextBlock label="Your comments" text={r.employee_comments} />
                    <p className="text-xs text-zinc-500">Acknowledged {formatDateTime(r.acknowledged_at)}</p>
                  </div>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
