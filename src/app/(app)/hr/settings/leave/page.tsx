import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import {
  addApprovalStep,
  addHoliday,
  addLeaveType,
  moveApprovalStep,
  removeHoliday,
  setApprovalStepActive,
  setLeaveTypeActive,
  updateApprovalStep,
  updateLeaveType,
} from "@/modules/hr/leave/actions";
import { ApprovalStepForm, HolidayForm, LeaveTypeForm } from "@/modules/hr/leave/components/forms";
import { APPROVAL_SCOPES, GENDERS } from "@/modules/hr/leave/constants";
import { listApprovalSteps, listHolidays, listLeaveTypes, type LeaveType } from "@/modules/hr/leave/queries";
import { hrModule } from "@/modules/hr/module";
import { listJobTitles } from "@/modules/hr/queries";

function describeType(t: LeaveType): string {
  return [
    t.uses_balance ? `${t.days_per_year} days a year` : "No yearly limit",
    t.is_paid ? "paid" : "unpaid",
    t.prorate && "pro-rated for new starters",
    t.max_days_per_request && `at most ${t.max_days_per_request} days at a time`,
    t.document_after_days !== null &&
      (t.document_after_days === 0 ? "always needs a document" : `document needed over ${t.document_after_days} days`),
    t.extra_days_after_5_years > 0 && `+${t.extra_days_after_5_years} after 5 years`,
    t.extra_days_after_10_years > 0 && `+${t.extra_days_after_10_years} after 10 years`,
    t.only_for_gender && GENDERS[t.only_for_gender].toLowerCase(),
  ]
    .filter(Boolean)
    .join(" · ");
}

export default async function LeaveSettingsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const staff = await requireModule(hrModule);
  if (!staff.permissions.has("hr.read")) notFound();
  const canConfigure = staff.permissions.has("hr.config");
  const thisYear = new Date().getFullYear();
  const { year: yearParam } = await searchParams;
  const year = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : thisYear;

  const [types, steps, holidays, jobTitles] = await Promise.all([listLeaveTypes(), listApprovalSteps(), listHolidays(year), listJobTitles()]);
  const titleName = new Map(jobTitles.map((t) => [t.id, t.name]));
  const activeSteps = steps.filter((s) => s.is_active);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Leave settings"
        description={
          canConfigure
            ? "Changes apply to requests made from now on; requests already made keep their days and approvers."
            : "Only the Head of HR can change these settings."
        }
      />

      <Card title="Leave types" actions={canConfigure && <LeaveTypeForm action={addLeaveType} />}>
        {types.length === 0 ? (
          <EmptyState>No leave types yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className={t.is_active ? "" : "text-zinc-400"}>
                  <p className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {!t.is_active && <Badge>Switched off</Badge>}
                  </p>
                  <p className="text-xs text-zinc-500">{describeType(t)}</p>
                </div>
                {canConfigure && (
                  <div className="flex flex-wrap items-start gap-2">
                    <LeaveTypeForm action={updateLeaveType.bind(null, t.id)} values={t} />
                    <ActionButton
                      action={setLeaveTypeActive.bind(null, t.id, !t.is_active)}
                      label={t.is_active ? "Switch off" : "Switch on"}
                      variant="secondary"
                      confirm={
                        t.is_active
                          ? `Switch off ${t.name.toLowerCase()}? Nobody can ask for it any more; requests already made are kept.`
                          : undefined
                      }
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Approval chain" actions={canConfigure && <ApprovalStepForm action={addApprovalStep} jobTitles={jobTitles} />}>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-zinc-600">
          <li>The relief officer, if the employee chose one, agrees first.</li>
          <li>Then each step in order, approved by someone holding one of its job titles in the right place.</li>
          <li>A step is skipped when nobody holds those job titles there with an ERP login.</li>
          <li>If every step is skipped, the request goes to the Head of HR.</li>
          <li>Nobody approves their own leave, and the Head of HR can decide any request outright.</li>
        </ul>
        {steps.length === 0 ? (
          <EmptyState>No steps: every request goes to the Head of HR.</EmptyState>
        ) : (
          <ol className="divide-y divide-zinc-100 text-sm">
            {steps.map((s) => {
              const position = activeSteps.findIndex((a) => a.id === s.id);
              const index = steps.indexOf(s);
              return (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className={`flex gap-3 ${s.is_active ? "" : "text-zinc-400"}`}>
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium text-zinc-600">
                      {position >= 0 ? position + 1 : "–"}
                    </span>
                    <div>
                      <p className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {!s.is_active && <Badge>Switched off</Badge>}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {s.job_title_ids.map((id) => titleName.get(id) ?? "Unknown title").join(" or ")} ·{" "}
                        {APPROVAL_SCOPES[s.scope].toLowerCase()}
                        {s.same_department && " · same department"}
                      </p>
                    </div>
                  </div>
                  {canConfigure && (
                    <div className="flex flex-wrap items-start gap-2">
                      <ActionButton
                        action={moveApprovalStep.bind(null, s.id, "up")}
                        label="Move up"
                        variant="secondary"
                        disabled={index === 0}
                      />
                      <ActionButton
                        action={moveApprovalStep.bind(null, s.id, "down")}
                        label="Move down"
                        variant="secondary"
                        disabled={index === steps.length - 1}
                      />
                      <ApprovalStepForm
                        action={updateApprovalStep.bind(null, s.id)}
                        jobTitles={jobTitles}
                        values={{ name: s.name, job_title_ids: s.job_title_ids, scope: s.scope, same_department: s.same_department }}
                      />
                      <ActionButton
                        action={setApprovalStepActive.bind(null, s.id, !s.is_active)}
                        label={s.is_active ? "Switch off" : "Switch on"}
                        variant="secondary"
                        confirm={
                          s.is_active
                            ? `Switch off the ${s.name} step? New requests will skip it; requests already made still go through it.`
                            : undefined
                        }
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card title={`Public holidays in ${year}`} actions={canConfigure && <HolidayForm action={addHoliday} year={year} />}>
        <p className="mb-3 text-sm text-zinc-600">
          Public holidays don&apos;t count as leave days. Add Eid and other holidays as the government declares them.
        </p>
        <nav className="mb-3 flex gap-3 text-sm">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <Link
              key={y}
              href={`/hr/settings/leave?year=${y}`}
              className={y === year ? "font-semibold text-ink" : "text-zinc-600 hover:underline"}
            >
              {y}
            </Link>
          ))}
        </nav>
        {holidays.length === 0 ? (
          <EmptyState>No public holidays recorded for {year}.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {holidays.map((h) => (
              <li key={h.holiday_date} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="inline-block w-32 text-zinc-600">{formatDate(h.holiday_date)}</span>
                  <span className="font-medium">{h.name}</span>
                </span>
                {canConfigure && (
                  <ActionButton
                    action={removeHoliday.bind(null, h.holiday_date)}
                    label="Remove"
                    variant="secondary"
                    confirm={`Remove ${h.name}? Requests already made keep their day count.`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
