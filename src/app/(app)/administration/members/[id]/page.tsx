import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import {
  addPlan,
  approveMember,
  recordContribution,
  removeDocument,
  returnMember,
  reverseContribution,
  submitMember,
  uploadDocument,
  verifyContribution,
} from "@/modules/administration/actions";
import { ActionButton } from "@/modules/administration/components/action-button";
import { DocumentUpload } from "@/modules/administration/components/document-upload";
import { ContributionForm, PlanForm, ReturnForm, ReversalForm } from "@/modules/administration/components/forms";
import {
  CONTRIBUTION_KINDS,
  DOCUMENT_TYPES,
  FREQUENCIES,
  ID_TYPES,
  MEMBER_STATUSES,
  PAYMENT_METHODS,
  REQUIRED_DOCUMENTS,
} from "@/modules/administration/constants";
import { administrationModule } from "@/modules/administration/module";
import { fullName, getMemberBundle, listBranches } from "@/modules/administration/queries";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(administrationModule);
  const { id } = await params;
  const bundle = await getMemberBundle(id);
  if (!bundle) notFound();
  const { member, documents, plans, totals, contributions, planTypes, staffName } = bundle;

  const branch = (await listBranches()).find((b) => b.id === member.branch_id)!;
  const can = (permission: string) => staff.permissions.hasForBranch(permission, branch);
  const editable = ["draft", "returned"].includes(member.status);
  const canManage = can("members.manage");
  const canEdit = (editable && canManage) || (member.status === "approved" && can("members.amend"));
  const isPreparer = staff.id === member.created_by || staff.id === member.submitted_by;
  const canDecide = member.status === "pending_approval" && can("members.approve") && !isPreparer;
  const missing = REQUIRED_DOCUMENTS.filter((t) => !documents.some((d) => d.document_type === t));
  const status = MEMBER_STATUSES[member.status];
  const planName = new Map(planTypes.map((p) => [p.code, p.name]));
  const reversed = new Set(contributions.filter((c) => c.reverses_id).map((c) => c.reverses_id));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={fullName(member)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{branch.name}</span>
            {member.membership_no && <span className="font-mono text-xs">{member.membership_no}</span>}
          </span>
        }
        actions={
          canEdit && (
            <ButtonLink href={`/administration/members/${member.id}/edit`} variant="secondary">
              Edit details
            </ButtonLink>
          )
        }
      />

      {member.status === "returned" && member.return_reason && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">Returned by the Branch Manager</p>
          <p className="mt-1">{member.return_reason}</p>
        </div>
      )}

      {/* Workflow */}
      {editable && canManage && (
        <Card title="Send for approval">
          {missing.length > 0 ? (
            <p className="text-sm text-zinc-700">
              Upload these before sending the file to the Branch Manager:{" "}
              <strong>{missing.map((t) => DOCUMENT_TYPES[t]).join(", ")}</strong>.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-sm text-zinc-700">All required documents are uploaded. Check the details, then send the file.</p>
              <ActionButton
                action={submitMember.bind(null, member.id)}
                label="Send to Branch Manager"
                pendingLabel="Sending…"
                confirm="Send this file to the Branch Manager? You won't be able to edit it until it's returned."
              />
            </div>
          )}
        </Card>
      )}

      {member.status === "pending_approval" && (
        <Card title="Branch Manager review">
          {canDecide ? (
            <div className="flex flex-wrap items-start gap-3">
              <ActionButton
                action={approveMember.bind(null, member.id)}
                label="Approve and sign"
                pendingLabel="Approving…"
                confirm="Approve this member? A membership number will be issued."
              />
              <ReturnForm action={returnMember.bind(null, member.id)} />
            </div>
          ) : (
            <p className="text-sm text-zinc-700">
              Sent by {staffName(member.submitted_by)} on {formatDateTime(member.submitted_at)}.{" "}
              {isPreparer && can("members.approve")
                ? "You prepared this file, so another Branch Manager has to approve it."
                : "Waiting for the Branch Manager."}
            </p>
          )}
        </Card>
      )}

      {/* Details */}
      <Card title="Member details">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Phone">{member.phone}</Detail>
          <Detail label="Email">{member.email}</Detail>
          <Detail label="Date of birth">{formatDate(member.date_of_birth)}</Detail>
          <Detail label="Address">{member.address}</Detail>
          <Detail label="NIN">{member.nin}</Detail>
          <Detail label="Means of ID">
            {ID_TYPES[member.id_type as keyof typeof ID_TYPES]} · {member.id_number}
          </Detail>
          <Detail label="Next of kin">
            {[member.next_of_kin_name, member.next_of_kin_relationship, member.next_of_kin_phone].filter(Boolean).join(" · ")}
          </Detail>
          <Detail label="Prepared by">
            {staffName(member.created_by)}, {formatDate(member.created_at)}
          </Detail>
          <Detail label="Approved by">
            {member.approved_by ? `${staffName(member.approved_by)}, ${formatDate(member.approved_at)}` : null}
          </Detail>
        </dl>
      </Card>

      {/* Documents */}
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
                  {editable && canManage && (
                    <ActionButton
                      action={removeDocument.bind(null, member.id, d.id)}
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
        {canManage && member.status !== "pending_approval" && <DocumentUpload action={uploadDocument.bind(null, member.id)} />}
      </Card>

      {/* Plans and contributions */}
      {member.status === "approved" && (
        <Card
          title="Plans and contributions"
          actions={canManage && <PlanForm action={addPlan.bind(null, member.id)} planTypes={planTypes} />}
        >
          {plans.length === 0 ? (
            <EmptyState>No plans yet.</EmptyState>
          ) : (
            <div className="space-y-6">
              {plans.map((plan) => {
                const t = totals.get(plan.id);
                const rows = contributions.filter((c) => c.member_plan_id === plan.id);
                return (
                  <div key={plan.id} className="rounded-lg border border-zinc-200">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 p-4">
                      <div>
                        <p className="font-medium">
                          {planName.get(plan.plan_type) ?? plan.plan_type} · {formatMoney(plan.contribution_amount)}{" "}
                          {FREQUENCIES[plan.contribution_frequency as keyof typeof FREQUENCIES].toLowerCase()}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {formatDate(plan.start_date)} to {formatDate(plan.maturity_date)} · {plan.status}
                        </p>
                      </div>
                      <dl className="flex gap-6 text-right">
                        <Detail label="Total contributed">{formatMoney(t?.total_contributed)}</Detail>
                        <Detail label="Of which top-ups">{formatMoney(t?.total_top_ups)}</Detail>
                        <Detail label="Verified">{formatMoney(t?.total_verified)}</Detail>
                      </dl>
                    </div>
                    {rows.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="text-xs text-zinc-500">
                            <tr>
                              <th className="px-4 py-2 font-medium">Date</th>
                              <th className="px-4 py-2 font-medium">Type</th>
                              <th className="px-4 py-2 text-right font-medium">Amount</th>
                              <th className="px-4 py-2 font-medium">Method / ref.</th>
                              <th className="px-4 py-2 font-medium">Status</th>
                              <th className="px-4 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((c) => (
                              <tr key={c.id} className="border-t border-zinc-100 align-top">
                                <td className="whitespace-nowrap px-4 py-2">{formatDate(c.paid_on)}</td>
                                <td className="px-4 py-2">
                                  {CONTRIBUTION_KINDS[c.kind]}
                                  {c.notes && <div className="text-xs text-zinc-500">{c.notes}</div>}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(c.amount)}</td>
                                <td className="px-4 py-2">
                                  {PAYMENT_METHODS[c.payment_method as keyof typeof PAYMENT_METHODS]}
                                  {c.reference && <div className="font-mono text-xs text-zinc-500">{c.reference}</div>}
                                </td>
                                <td className="px-4 py-2">
                                  {c.verified_at ? (
                                    <Badge tone="green">Verified</Badge>
                                  ) : (
                                    <Badge tone="amber">Unverified</Badge>
                                  )}
                                  {reversed.has(c.id) && (
                                    <span className="ml-1">
                                      <Badge>Reversed</Badge>
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    {!c.verified_at && can("contributions.verify") && c.recorded_by !== staff.id && (
                                      <ActionButton
                                        action={verifyContribution.bind(null, member.id, c.id)}
                                        label="Verify"
                                        variant="secondary"
                                      />
                                    )}
                                    {c.kind !== "reversal" && !reversed.has(c.id) && can("contributions.record") && (
                                      <ReversalForm action={reverseContribution.bind(null, member.id)} contributionId={c.id} />
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {plan.status === "active" && can("contributions.record") && (
                      <div className="flex flex-wrap gap-2 border-t border-zinc-100 p-4">
                        <ContributionForm action={recordContribution.bind(null, member.id)} planId={plan.id} kind="scheduled" />
                        <ContributionForm action={recordContribution.bind(null, member.id)} planId={plan.id} kind="top_up" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
