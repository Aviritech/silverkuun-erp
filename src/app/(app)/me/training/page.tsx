import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { enrolMyself, giveFeedback, withdrawMyself } from "@/modules/hr/training/actions";
import { FeedbackForm } from "@/modules/hr/training/components";
import { ENROLMENT_STATUSES } from "@/modules/hr/training/constants";
import { earnedCertificate, listMyEnrolments, listTrainings, seatsTaken, today, type Training } from "@/modules/hr/training/queries";
import { requireMyEmployee } from "@/modules/me/queries";

function When({ t }: { t: Training }) {
  return (
    <>
      {formatDate(t.starts_on)}
      {t.ends_on !== t.starts_on && ` to ${formatDate(t.ends_on)}`}
      {" · "}
      {t.is_virtual ? "Online" : (t.venue ?? "Venue to be confirmed")}
      {t.hours && ` · ${Number(t.hours)} hours`}
    </>
  );
}

export default async function MyTrainingPage() {
  const { employee } = await requireMyEmployee();
  const [trainings, enrolments] = await Promise.all([listTrainings(), listMyEnrolments(employee.id)]);
  const now = today();
  const enrolledIn = new Set(enrolments.filter((e) => e.status !== "withdrawn").map((e) => e.training_id));
  const candidates = trainings.filter(
    (t) =>
      t.status === "scheduled" &&
      t.starts_on >= now &&
      !enrolledIn.has(t.id) &&
      (t.departments.length === 0 || t.departments.includes(employee.department_code)),
  );
  const taken = await seatsTaken(candidates.map((t) => t.id));
  const open = candidates.filter((t) => t.capacity === null || (taken.get(t.id) ?? 0) < t.capacity).reverse();

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="My training" description="Courses you can join, and the ones you have taken." />

      <Card title="Open for enrolment">
        {open.length === 0 ? (
          <EmptyState>There is no training open to you right now.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {open.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-zinc-500">
                    <When t={t} />
                    {t.trainer && ` · ${t.trainer}`}
                    {t.capacity !== null && ` · ${t.capacity - (taken.get(t.id) ?? 0)} places left`}
                  </p>
                  {t.description && <p className="mt-1 text-zinc-600">{t.description}</p>}
                </div>
                <ActionButton action={enrolMyself.bind(null, t.id)} label="Enrol" pendingLabel="Enrolling…" confirm={`Enrol in ${t.title}?`} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="My enrolments">
        {enrolments.length === 0 ? (
          <EmptyState>You haven&apos;t enrolled in any training yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {enrolments.map((e) => {
              const t = e.trainings;
              const s = ENROLMENT_STATUSES[e.status];
              return (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.title}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {t.status === "cancelled" && <Badge tone="gray">Training cancelled</Badge>}
                    </p>
                    <p className="text-xs text-zinc-500">
                      <When t={t} />
                    </p>
                    {t.is_virtual && t.meeting_url && e.status === "enrolled" && (
                      <a href={t.meeting_url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-4">
                        Meeting link
                      </a>
                    )}
                    {e.status === "completed" && (
                      <p className="mt-1">
                        {e.hours_attended !== null && `${Number(e.hours_attended)} hours attended`}
                        {e.score !== null && ` · score ${Number(e.score)}%`}
                        {t.pass_mark !== null && (
                          <span className="ml-2">
                            <Badge tone={e.passed ? "green" : "red"}>{e.passed ? "Passed" : "Not passed"}</Badge>
                          </span>
                        )}
                      </p>
                    )}
                    {e.feedback_rating !== null && (
                      <p className="mt-1 text-xs text-zinc-500">
                        Your rating: {e.feedback_rating} / 5{e.feedback_comment && ` · ${e.feedback_comment}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {e.status === "enrolled" && t.starts_on > now && (
                      <ActionButton
                        action={withdrawMyself.bind(null, t.id, e.id)}
                        label="Withdraw"
                        variant="secondary"
                        confirm={`Withdraw from ${t.title}? Your place goes to someone else.`}
                      />
                    )}
                    {e.status === "completed" && (
                      <FeedbackForm
                        action={giveFeedback.bind(null, t.id, e.id)}
                        existing={{ rating: e.feedback_rating, comment: e.feedback_comment }}
                      />
                    )}
                    {earnedCertificate(e) && (
                      <ButtonLink href={`/me/training/${e.id}/certificate`} variant="secondary">
                        Certificate
                      </ButtonLink>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
