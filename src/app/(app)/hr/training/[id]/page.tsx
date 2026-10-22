import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/modules/me/queries";
import { hrModule } from "@/modules/hr/module";
import { listDepartments } from "@/modules/hr/queries";
import { enrolEmployee, recordResult, setTrainingStatus, withdrawEnrolment } from "@/modules/hr/training/actions";
import { EnrolForm, ResultForm } from "@/modules/hr/training/components";
import { ENROLMENT_STATUSES, TRAINING_STATUSES } from "@/modules/hr/training/constants";
import { getTraining, today } from "@/modules/hr/training/queries";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

type EmployeeOption = { id: string; first_name: string; last_name: string; employee_no: string; branch_id: string; department_code: string };

export default async function TrainingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(hrModule);
  const { id } = await params;
  const found = await getTraining(id);
  if (!found) notFound();
  const { training: t, enrolments } = found;

  const [{ branches }, departments, me] = await Promise.all([listOrg(), listDepartments(), getMyEmployee()]);
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const departmentName = new Map(departments.map((d) => [d.code, d.name]));
  const manages = (branchId: string | undefined) => {
    const b = branchId ? branchById.get(branchId) : undefined;
    return !!b && staff.permissions.hasForBranch("training.manage", b);
  };

  const now = today();
  const canManage = staff.permissions.has("training.manage");
  const enrolmentOpen = t.status === "scheduled" && t.starts_on >= now;
  const started = t.starts_on <= now;
  const active = enrolments.filter((e) => e.status !== "withdrawn");
  const full = t.capacity !== null && active.length >= t.capacity;

  let candidates: { id: string; label: string }[] = [];
  if (canManage && enrolmentOpen && !full) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("employees")
      .select("id, first_name, last_name, employee_no, branch_id, department_code")
      .in("status", ["probation", "active"])
      .order("first_name")
      .order("last_name");
    if (error) throw dbFailure(error);
    const taken = new Set(active.map((e) => e.employee_id));
    const forTraining = (e: EmployeeOption) => t.departments.length === 0 || t.departments.includes(e.department_code);
    candidates = (data as EmployeeOption[])
      .filter((e) => !taken.has(e.id) && manages(e.branch_id))
      // People in the departments it is for come first.
      .sort((a, b) => Number(forTraining(b)) - Number(forTraining(a)))
      .map((e) => ({
        id: e.id,
        label: `${e.first_name} ${e.last_name} (${e.employee_no}), ${departmentName.get(e.department_code) ?? e.department_code}, ${branchById.get(e.branch_id)?.name ?? ""}`,
      }));
  }

  const rated = enrolments.filter((e) => e.feedback_rating !== null);
  const averageRating = rated.length ? rated.reduce((sum, e) => sum + (e.feedback_rating ?? 0), 0) / rated.length : null;
  const s = TRAINING_STATUSES[t.status];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={t.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span>
              {formatDate(t.starts_on)}
              {t.ends_on !== t.starts_on && ` to ${formatDate(t.ends_on)}`}
            </span>
          </span>
        }
        actions={
          <>
            {canManage && t.status === "scheduled" && (
              <>
                <ActionButton
                  action={setTrainingStatus.bind(null, t.id, "completed")}
                  label="Mark completed"
                  variant="secondary"
                  disabled={!started}
                  title={started ? undefined : "It hasn't started yet"}
                  confirm="Mark this training as completed? Record everyone's results first."
                />
                <ActionButton
                  action={setTrainingStatus.bind(null, t.id, "cancelled")}
                  label="Cancel training"
                  variant="danger"
                  confirm="Cancel this training? Staff can no longer enrol."
                />
              </>
            )}
            <ButtonLink href="/hr/training" variant="secondary">
              All training
            </ButtonLink>
          </>
        }
      />

      <Card title="Details">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label="Trainer">{t.trainer}</Detail>
          <Detail label="Where">
            {t.is_virtual ? (
              t.meeting_url ? (
                <a href={t.meeting_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Online
                </a>
              ) : (
                "Online"
              )
            ) : (
              t.venue
            )}
          </Detail>
          <Detail label="Hours">{t.hours && Number(t.hours)}</Detail>
          <Detail label="Places">
            {active.length}
            {t.capacity !== null ? ` of ${t.capacity} taken` : " enrolled, no limit"}
          </Detail>
          <Detail label="For">
            {t.departments.length === 0 ? "Everyone" : t.departments.map((d) => departmentName.get(d) ?? d).join(", ")}
          </Detail>
          <Detail label="Pass mark">{t.pass_mark === null ? "Not scored" : `${t.pass_mark}%`}</Detail>
          <Detail label="Cost per person">{t.cost_per_person && formatMoney(t.cost_per_person)}</Detail>
          <Detail label="Total cost">{t.cost_per_person && formatMoney(Number(t.cost_per_person) * active.length)}</Detail>
        </dl>
        {t.description && <p className="mt-4 whitespace-pre-line text-sm text-zinc-700">{t.description}</p>}
      </Card>

      <Card
        title="Enrolments"
        actions={
          canManage && enrolmentOpen && (full ? <Badge tone="amber">Full</Badge> : candidates.length > 0 && <EnrolForm action={enrolEmployee.bind(null, t.id)} people={candidates} />)
        }
      >
        {enrolments.length === 0 ? (
          <EmptyState>Nobody is enrolled yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Hours</th>
                  <th className="py-2 pr-4 font-medium">Score</th>
                  <th className="py-2 pr-4 font-medium">Feedback</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {enrolments.map((e) => {
                  const es = ENROLMENT_STATUSES[e.status];
                  const emp = e.employees;
                  const mine = manages(emp?.branch_id);
                  const isSelf = me?.id === e.employee_id;
                  return (
                    <tr key={e.id} className="border-b border-zinc-100 align-top last:border-0">
                      <td className="py-2 pr-4">
                        <span className="font-medium">{emp ? `${emp.first_name} ${emp.last_name}` : "Employee"}</span>
                        {emp && (
                          <div className="text-xs text-zinc-500">
                            {departmentName.get(emp.department_code) ?? emp.department_code}, {branchById.get(emp.branch_id)?.name}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone={es.tone}>{es.label}</Badge>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{e.hours_attended !== null ? Number(e.hours_attended) : "—"}</td>
                      <td className="py-2 pr-4">
                        {e.score !== null ? <span className="tabular-nums">{Number(e.score)}%</span> : "—"}
                        {e.status === "completed" && t.pass_mark !== null && (
                          <span className="ml-2">
                            <Badge tone={e.passed ? "green" : "red"}>{e.passed ? "Passed" : "Failed"}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="max-w-xs py-2 pr-4">
                        {e.feedback_rating !== null ? (
                          <>
                            <span className="tabular-nums">{e.feedback_rating} / 5</span>
                            {e.feedback_comment && <p className="text-xs text-zinc-600">{e.feedback_comment}</p>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2">
                        {canManage && mine && (
                          <div className="flex flex-wrap items-start gap-2">
                            {e.status === "enrolled" && t.starts_on > now && (
                              <ActionButton
                                action={withdrawEnrolment.bind(null, t.id, e.id)}
                                label="Withdraw"
                                variant="secondary"
                                confirm={`Withdraw ${emp?.first_name ?? "this person"} from the training? Their place becomes free.`}
                              />
                            )}
                            {started && e.status !== "withdrawn" && t.status !== "cancelled" && !isSelf && (
                              <ResultForm action={recordResult.bind(null, t.id, e.id)} passMark={t.pass_mark} hours={t.hours} />
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Feedback">
        {averageRating === null ? (
          <EmptyState>No feedback yet. Staff can rate the training once their result is recorded as completed.</EmptyState>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              Average rating <span className="font-semibold tabular-nums">{averageRating.toFixed(1)} / 5</span> from {rated.length}{" "}
              {rated.length === 1 ? "person" : "people"}.
            </p>
            <ul className="divide-y divide-zinc-100">
              {rated
                .filter((e) => e.feedback_comment)
                .map((e) => (
                  <li key={e.id} className="py-2">
                    <span className="tabular-nums text-zinc-500">{e.feedback_rating} / 5</span> · {e.feedback_comment}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
