import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/action-button";
import { SecretButton } from "@/components/secret-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import {
  addContract,
  addDependent,
  addQualification,
  changeContractEnd,
  changeJob,
  confirmEmployee,
  createLogin,
  recordExit,
  reinstateEmployee,
  removeDependent,
  removeDocument,
  removeQualification,
  uploadDocument,
} from "@/modules/hr/actions";
import {
  ConfirmForm,
  ContractEndForm,
  ContractForm,
  DependentForm,
  DocumentUpload,
  ExitForm,
  JobChangeForm,
  QualificationForm,
  ReinstateForm,
} from "@/modules/hr/components/forms";
import {
  CONTRACT_TYPES,
  DOCUMENT_TYPES,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  ID_TYPES,
  JOB_EVENTS,
  MARITAL_STATUSES,
  QUALIFICATION_KINDS,
  RELATIONSHIPS,
} from "@/modules/hr/constants";
import { hrModule } from "@/modules/hr/module";
import { currentContract, employeeName, getEmployeeBundle, listDepartments, listJobTitles } from "@/modules/hr/queries";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

/** A certification that has expired or expires within 60 days, so HR arranges the renewal. */
function expiresSoon(expiresOn: string) {
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 60);
  return expiresOn <= horizon.toISOString().slice(0, 10);
}

function label<T extends Record<string, string>>(choices: T, value: string | null) {
  return value ? (choices[value as keyof T] ?? value) : null;
}

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(hrModule);
  const { id } = await params;
  const bundle = await getEmployeeBundle(id);
  if (!bundle) notFound();
  const { employee: e, documents, photoUrl, contracts, history, dependents, qualifications, login, staffName } = bundle;

  const [{ branches }, departments, jobTitles] = await Promise.all([listOrg(), listDepartments(), listJobTitles()]);
  const branch = branches.find((b) => b.id === e.branch_id)!;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const departmentName = new Map(departments.map((d) => [d.code, d.name]));
  const titleName = new Map(jobTitles.map((t) => [t.id, t.name]));

  const can = (permission: string) => staff.permissions.hasForBranch(permission, branch);
  const isSelf = e.staff_id === staff.id;
  const isCurrent = e.status === "probation" || e.status === "active";
  const canManage = can("hr.manage");
  const canDecide = can("hr.approve") && !isSelf;
  const status = EMPLOYEE_STATUSES[e.status];
  const contract = currentContract(contracts);
  const approverBranches = branches.filter((b) => staff.permissions.hasForBranch("hr.approve", b));

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start gap-5">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL from private storage
          <img src={photoUrl} alt="" className="h-20 w-20 rounded-xl object-cover ring-1 ring-zinc-200" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-ink text-xl font-semibold text-silver-200">
            {e.first_name[0]}
            {e.last_name[0]}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <PageHeader
            title={employeeName(e)}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="font-mono text-xs">{e.employee_no}</span>
                <span>
                  {titleName.get(e.job_title_id)} · {departmentName.get(e.department_code) ?? e.department_code} · {branch.name}
                </span>
              </span>
            }
            actions={
              <>
                {staff.permissions.has("payroll.read") && (
                  <ButtonLink href={`/hr/employees/${e.id}/pay`} variant="secondary">
                    Pay and deductions
                  </ButtonLink>
                )}
                {canManage && (
                  <ButtonLink href={`/hr/employees/${e.id}/edit`} variant="secondary">
                    Edit details
                  </ButtonLink>
                )}
              </>
            }
          />
        </div>
      </div>

      {!isCurrent && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800">
          <p className="font-medium">
            {status.label} on {formatDate(e.exit_date)}
          </p>
          {e.exit_reason && <p className="mt-1">{e.exit_reason}</p>}
        </div>
      )}

      {/* Head of HR decisions */}
      {canDecide && (
        <Card title="Changes to employment">
          <div className="flex flex-wrap items-start gap-3">
            {e.status === "probation" && <ConfirmForm action={confirmEmployee.bind(null, e.id)} />}
            {isCurrent && (
              <JobChangeForm
                action={changeJob.bind(null, e.id)}
                branches={approverBranches}
                departments={departments}
                jobTitles={jobTitles}
                current={{ branch_id: e.branch_id, department_code: e.department_code, job_title_id: e.job_title_id }}
              />
            )}
            {isCurrent && <ExitForm action={recordExit.bind(null, e.id)} />}
            {!isCurrent && <ReinstateForm action={reinstateEmployee.bind(null, e.id)} />}
          </div>
        </Card>
      )}
      {can("hr.approve") && isSelf && (
        <p className="text-sm text-zinc-600">This is your own record, so another Head of HR has to confirm, move or exit you.</p>
      )}

      {/* ERP login */}
      <Card title="ERP login">
        {e.staff_id && login ? (
          <div className="space-y-2 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              Signs in as <strong>{e.work_email}</strong>
              {login.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Switched off</Badge>}
              {login.must_change_password && <Badge tone="amber">Hasn&apos;t changed the temporary password</Badge>}
            </p>
            <p className="text-zinc-600">
              {login.roles.length > 0
                ? `Access: ${login.roles.join(", ")}.`
                : "No department access yet. Ask a System Administrator to give them a role."}
            </p>
          </div>
        ) : isCurrent && canManage ? (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-700">
              {e.work_email
                ? `Create a login for ${e.work_email}. You'll get a temporary password to give them.`
                : "Add a work email on Edit details first; it's what they'll sign in with."}
            </p>
            {e.work_email && (
              <SecretButton
                action={createLogin.bind(null, e.id)}
                label="Create ERP login"
                pendingLabel="Creating…"
                confirm={`Create an ERP login for ${e.work_email}? You'll see a temporary password once.`}
              />
            )}
          </div>
        ) : (
          <EmptyState>No ERP login.</EmptyState>
        )}
      </Card>

      {/* Details */}
      <Card title="Employment">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label="Employment type">{label(EMPLOYMENT_TYPES, e.employment_type)}</Detail>
          <Detail label="Hire date">{formatDate(e.hire_date)}</Detail>
          <Detail label="Probation ends">{e.probation_end_date && formatDate(e.probation_end_date)}</Detail>
          <Detail label="Confirmed">{e.confirmed_on && formatDate(e.confirmed_on)}</Detail>
          <Detail label="Current contract">
            {contract
              ? `${CONTRACT_TYPES[contract.contract_type]}${contract.end_date ? `, to ${formatDate(contract.end_date)}` : ""}`
              : null}
          </Detail>
          <Detail label="Record created by">
            {staffName(e.created_by)}, {formatDate(e.created_at)}
          </Detail>
        </dl>
      </Card>

      <Card title="Personal details">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label="Date of birth">{e.date_of_birth && formatDate(e.date_of_birth)}</Detail>
          <Detail label="Gender">{e.gender && (e.gender === "female" ? "Female" : "Male")}</Detail>
          <Detail label="Marital status">{label(MARITAL_STATUSES, e.marital_status)}</Detail>
          <Detail label="State of origin">{[e.state_of_origin, e.nationality].filter(Boolean).join(", ")}</Detail>
          <Detail label="Phone">{e.phone}</Detail>
          <Detail label="Work email">{e.work_email}</Detail>
          <Detail label="Personal email">{e.personal_email}</Detail>
          <Detail label="Address">{e.address}</Detail>
          <Detail label="NIN">{e.nin}</Detail>
          <Detail label="Means of ID">{[label(ID_TYPES, e.id_type), e.id_number].filter(Boolean).join(" · ")}</Detail>
          <Detail label="Emergency contact">
            {[e.emergency_contact_name, e.emergency_contact_relationship, e.emergency_contact_phone].filter(Boolean).join(" · ")}
          </Detail>
        </dl>
      </Card>

      <Card title="Pay details">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label="Bank">{[e.bank_name, e.bank_account_number].filter(Boolean).join(" · ")}</Detail>
          <Detail label="Tax ID (TIN)">{e.tax_id}</Detail>
          <Detail label="Pension administrator">{e.pension_administrator}</Detail>
          <Detail label="Pension PIN">{e.pension_pin}</Detail>
          <Detail label="Annual rent (for rent relief)">{e.annual_rent ? formatMoney(e.annual_rent) : null}</Detail>
          <Detail label="Pension deducted">{e.pension_applies === false ? "No" : "Yes"}</Detail>
          <Detail label="NHF deducted">{e.nhf_applies === false ? "No" : "Yes"}</Detail>
        </dl>
      </Card>

      {/* Contracts */}
      <Card title="Contracts" actions={canManage && isCurrent && <ContractForm action={addContract.bind(null, e.id)} />}>
        {contracts.length === 0 ? (
          <EmptyState>No contracts recorded.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {[...contracts].reverse().map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
                <div>
                  <span className="font-medium">{CONTRACT_TYPES[c.contract_type]}</span>
                  <span className="ml-2 text-zinc-600">
                    {formatDate(c.start_date)} to {c.end_date ? formatDate(c.end_date) : "no end date"}
                  </span>
                  {c.id === contract?.id && (
                    <span className="ml-2">
                      <Badge tone="green">Current</Badge>
                    </span>
                  )}
                  {c.terminated_on && <div className="text-xs text-zinc-500">Ended early on {formatDate(c.terminated_on)}</div>}
                  {c.notes && <div className="text-xs text-zinc-500">{c.notes}</div>}
                </div>
                {canManage && !c.terminated_on && c.contract_type !== "permanent" && (
                  <ContractEndForm action={changeContractEnd.bind(null, e.id)} contractId={c.id} endDate={c.end_date} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Job history */}
      <Card title="Job history">
        <ol className="space-y-3 text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex gap-4">
              <span className="w-28 shrink-0 text-zinc-500">{formatDate(h.effective_date)}</span>
              <div>
                <p>
                  <span className="font-medium">{JOB_EVENTS[h.event]}</span> · {titleName.get(h.job_title_id)},{" "}
                  {departmentName.get(h.department_code) ?? h.department_code}, {branchName.get(h.branch_id)}
                </p>
                {h.reason && <p className="text-zinc-600">{h.reason}</p>}
                {h.recorded_by && (
                  <p className="text-xs text-zinc-500">
                    Recorded by {staffName(h.recorded_by)}, {formatDateTime(h.recorded_at)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Dependents" actions={canManage && <DependentForm action={addDependent.bind(null, e.id)} />}>
          {dependents.length === 0 ? (
            <EmptyState>None recorded.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {dependents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{d.full_name}</span>
                    <span className="ml-2 text-zinc-600">
                      {label(RELATIONSHIPS, d.relationship)}
                      {d.date_of_birth && `, born ${formatDate(d.date_of_birth)}`}
                    </span>
                  </span>
                  {canManage && (
                    <ActionButton
                      action={removeDependent.bind(null, e.id, d.id)}
                      label="Remove"
                      variant="secondary"
                      confirm={`Remove ${d.full_name} from the dependents?`}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Qualifications" actions={canManage && <QualificationForm action={addQualification.bind(null, e.id)} />}>
          {qualifications.length === 0 ? (
            <EmptyState>None recorded.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {qualifications.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{q.qualification}</span>
                    {q.course && <span> in {q.course}</span>}
                    <span className="block text-xs text-zinc-500">
                      {[QUALIFICATION_KINDS[q.kind], q.institution, q.year_obtained].filter(Boolean).join(" · ")}
                    </span>
                    {q.expires_on && (
                      <span className={`block text-xs ${expiresSoon(q.expires_on) ? "font-medium text-red-700" : "text-zinc-500"}`}>
                        {q.expires_on < new Date().toISOString().slice(0, 10) ? "Expired" : "Expires"} {formatDate(q.expires_on)}
                      </span>
                    )}
                  </span>
                  {canManage && (
                    <ActionButton
                      action={removeQualification.bind(null, e.id, q.id)}
                      label="Remove"
                      variant="secondary"
                      confirm={`Remove ${q.qualification} from the qualifications?`}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Documents">
        {documents.length === 0 ? (
          <EmptyState>No documents uploaded yet.</EmptyState>
        ) : (
          <ul className="mb-4 divide-y divide-zinc-100">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium">{DOCUMENT_TYPES[d.document_type]}</span>
                  <span className="ml-2 text-zinc-500">
                    {d.file_name} · {formatDate(d.uploaded_at)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      View
                    </a>
                  )}
                  {canManage && (
                    <ActionButton
                      action={removeDocument.bind(null, e.id, d.id)}
                      label="Remove"
                      variant="secondary"
                      confirm="Remove this document from the file?"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canManage && <DocumentUpload action={uploadDocument.bind(null, e.id)} />}
      </Card>
    </div>
  );
}
