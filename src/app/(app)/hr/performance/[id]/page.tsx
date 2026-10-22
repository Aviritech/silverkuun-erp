import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { hrModule } from "@/modules/hr/module";
import { addScore, discardReview, removeScore, saveReviewNotes, submitReview, updateScore } from "@/modules/hr/performance/actions";
import { ReviewNotesForm, ScoreForm } from "@/modules/hr/performance/components";
import { REVIEW_STATUSES } from "@/modules/hr/performance/constants";
import { getReview, listPerformancePeople, staffNames } from "@/modules/hr/performance/queries";
import { ScoreBadge, ScoresTable, TextBlock } from "@/modules/hr/performance/review-view";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(hrModule);
  if (!staff.permissions.has("performance.read") && !staff.permissions.has("performance.review")) notFound();
  const { id } = await params;
  const found = await getReview(id);
  if (!found) notFound();
  const { review: r, scores } = found;

  const [people, { branches }, names] = await Promise.all([listPerformancePeople(), listOrg(), staffNames([found.review.reviewer_id])]);
  const person = people.find((p) => p.id === r.employee_id);
  const branch = branches.find((b) => b.id === person?.branch_id);
  const editable = r.status === "draft" && r.reviewer_id === staff.id;
  const status = REVIEW_STATUSES[r.status];
  const reviewer = r.reviewer_id === staff.id ? "you" : (names.get(r.reviewer_id) ?? "another reviewer");
  const average = scores.length ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length : null;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={`${person?.full_name ?? "Employee"}: ${r.period_label}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>
              {formatDate(r.period_start)} to {formatDate(r.period_end)}
              {branch && ` · ${branch.name}`} · Reviewed by {reviewer}
            </span>
          </span>
        }
        actions={
          <ButtonLink href="/hr/performance" variant="secondary">
            All reviews
          </ButtonLink>
        }
      />

      {r.status === "draft" && !editable && (
        <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
          This review is still a draft. Only {reviewer} can change it, and the employee can&apos;t see it yet.
        </p>
      )}

      <Card
        title="Scores"
        actions={editable && <ScoreForm action={addScore.bind(null, r.id)} openLabel="Add score" />}
      >
        {scores.length === 0 ? (
          <EmptyState>{editable ? "Add a score for each thing you are reviewing, from 1 (poor) to 5 (outstanding)." : "No scores yet."}</EmptyState>
        ) : (
          <div className="space-y-4">
            <ScoresTable
              scores={scores}
              actions={
                editable
                  ? (s) => (
                      <div className="flex flex-wrap items-start gap-2">
                        <ScoreForm action={updateScore.bind(null, r.id, s.id)} openLabel="Edit" initial={s} />
                        <ActionButton
                          action={removeScore.bind(null, r.id, s.id)}
                          label="Remove"
                          variant="secondary"
                          confirm={`Remove the score for ${s.criterion}?`}
                        />
                      </div>
                    )
                  : undefined
              }
            />
            <p className="flex items-center gap-2 text-sm">
              <span className="text-zinc-600">{r.status === "draft" ? "Overall so far:" : "Overall score:"}</span>
              <ScoreBadge score={r.overall_score ?? average} />
            </p>
          </div>
        )}
      </Card>

      {editable ? (
        <>
          <Card title="Summary">
            <ReviewNotesForm action={saveReviewNotes.bind(null, r.id)} initial={r} />
          </Card>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              action={submitReview.bind(null, r.id)}
              label="Submit review"
              pendingLabel="Submitting…"
              disabled={scores.length === 0}
              title={scores.length === 0 ? "Add at least one score first" : undefined}
              confirm="Submit this review? The employee will see it, and you can't change it after. Save your notes first."
            />
            <ActionButton
              action={discardReview.bind(null, r.id)}
              label="Discard draft"
              variant="danger"
              confirm="Discard this draft review? Its scores and notes will be deleted."
            />
          </div>
        </>
      ) : (
        <Card title="Summary">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextBlock label="Strengths" text={r.strengths} />
            <TextBlock label="Areas to improve" text={r.improvements} />
            <TextBlock label="Reviewer's comments" text={r.reviewer_comments} />
            <TextBlock label="Next review" text={r.next_review_date && formatDate(r.next_review_date)} />
          </div>
        </Card>
      )}

      {r.status !== "draft" && (
        <Card title="The employee's response">
          {r.status === "acknowledged" ? (
            <div className="space-y-3">
              <TextBlock label="Their comments" text={r.employee_comments} />
              <p className="text-xs text-zinc-500">Acknowledged {formatDateTime(r.acknowledged_at)}</p>
            </div>
          ) : (
            <EmptyState>Submitted {formatDateTime(r.submitted_at)}. Waiting for the employee to acknowledge it.</EmptyState>
          )}
        </Card>
      )}
    </div>
  );
}
