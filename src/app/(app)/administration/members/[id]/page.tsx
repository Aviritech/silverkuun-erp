import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { LOAN_STATUSES, type LoanStatus } from "@/modules/credit/constants";
import {
  addPlan,
  approveMember,
  marketerReview,
  recordContribution,
  recordDocumentIssue,
  removeDocument,
  returnMember,
  reverseContribution,
  sendToMarketer,
  submitMember,
  uploadDocument,
  verifyContribution,
} from "@/modules/administration/actions";
import { ActionButton } from "@/components/action-button";
import { DocumentUpload } from "@/modules/administration/components/document-upload";
import { ApprovalForm } from "@/modules/administration/components/approval-form";
import {
  ContributionForm,
  IssueForm,
  MarketerReviewForm,
  PlanForm,
  ReturnForm,
  ReversalForm,
} from "@/modules/administration/components/forms";
import {
  CONTRIBUTION_KINDS,
  DOCUMENT_TYPES,
  FREQUENCIES,
  ID_TYPES,
  ISSUE_CHANNELS,
  ISSUED_DOCUMENT_TYPES,
  MEMBER_STATUSES,
  OFFICER_EDITABLE,
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

/** The four hand-offs a new member file goes through. */
const STEPS = [
  { label: "Officer prepares", statuses: ["draft", "returned"] },
  { label: "Marketer confirms", statuses: ["with_marketer"] },
  { label: "Officer completes", statuses: ["marketer_reviewed"] },
  { label: "Branch Manager approves", statuses: ["pending_approval"] },
] as const;

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const staff = await requireModule(administrationModule);
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const bundle = await getMemberBundle(id);
  if (!bundle) notFound();
  const { member, documents, plans, totals, progress, contributions, planTypes, staffName } = bundle;

  const branch = (await listBranches()).find((b) => b.id === member.branch_id)!;
  const can = (permission: string) => staff.permissions.hasForBranch(permission, branch);
  const editable = OFFICER_EDITABLE.includes(member.status);
  const canManage = can("members.manage");
  const canEdit = (editable && canManage) || (member.status === "approved" && can("members.amend"));
  const isPreparer = [member.created_by, member.submitted_by, member.sent_to_marketer_by].includes(staff.id);
  const isReviewingMarketer = member.marketer_id === staff.id;
  const canDecide = member.status === "pending_approval" && can("members.approve") && !isPreparer && !isReviewingMarketer;
  const canMarketerReview = member.status === "with_marketer" && can("members.endorse") && !isPreparer;
  const missing = REQUIRED_DOCUMENTS.filter((t) => !documents.some((d) => d.document_type === t));
  const status = MEMBER_STATUSES[member.status];
  const planName = new Map(planTypes.map((p) => [p.code, p.name]));
  const reversed = new Set(contributions.filter((c) => c.reverses_id).map((c) => c.reverses_id));
  const seesLoans = can("credit.read");
  type MemberLoan = {
    id: string;
    loan_no: string;
    status: LoanStatus;
    product_name: string;
    amount_requested: string;
    approved_amount: string | null;
    outstanding_principal: string;
    outstanding_interest: string;
    days_past_due: number;
  };
  const loanQuery = seesLoans
    ? await (await createClient())
        .from("loan_book")
        .select("id, loan_no, status, product_name, amount_requested, approved_amount, outstanding_principal, outstanding_interest, days_past_due")
        .eq("member_id", member.id)
        .order("created_at", { ascending: false })
    : null;
  const loans = (loanQuery?.data ?? []) as MemberLoan[];

  // Once approved, the member's plans and contributions (and loans) each get their own tab.
  const tabs =
    member.status === "approved"
      ? [
          { key: "file", label: "Member file", href: `/administration/members/${member.id}` },
          { key: "plans", label: `Plans and contributions (${plans.length})`, href: `/administration/members/${member.id}?tab=plans` },
          ...(seesLoans ? [{ key: "loans", label: `Loans (${loans.length})`, href: `/administration/members/${member.id}?tab=loans` }] : []),
        ]
      : [];
  const tab = tabs.some((t) => t.key === tabParam) ? tabParam! : "file";
  const stepIndex = STEPS.findIndex((s) => (s.statuses as readonly string[]).includes(member.status));

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

      {tabs.length > 0 && <Tabs tabs={tabs} current={tab} />}

      {tab === "file" && (
        <>
          {member.status === "returned" && member.return_reason && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-medium">Returned by {member.returned_by ? staffName(member.returned_by) : "the Branch Manager"}</p>
              <p className="mt-1">{member.return_reason}</p>
              <p className="mt-1 text-xs">Correct it, then send it to the marketer again.</p>
            </div>
          )}

          {/* Workflow: Officer → Marketer → Officer → Branch Manager */}
          {stepIndex >= 0 && (
            <ol className="flex flex-wrap gap-2 text-xs" aria-label="Approval steps">
              {STEPS.map((step, i) => (
                <li
                  key={step.label}
                  aria-current={i === stepIndex ? "step" : undefined}
                  className={`rounded-full px-3 py-1 ring-1 ring-inset ${
                    i === stepIndex
                      ? "bg-ink text-white ring-ink"
                      : i < stepIndex
                        ? "bg-silver-50 text-zinc-700 ring-zinc-200"
                        : "bg-white text-zinc-500 ring-zinc-200"
                  }`}
                >
                  {i + 1}. {step.label}
                </li>
              ))}
            </ol>
          )}

          {["draft", "returned"].includes(member.status) && canManage && (
            <Card title="Send to the marketer">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-zinc-700">
                  A marketer at {branch.name} confirms the member first. The file comes back to you to finish the documents before it goes
                  to the Branch Manager.
                </p>
                <ActionButton
                  action={sendToMarketer.bind(null, member.id)}
                  label="Send to marketer"
                  pendingLabel="Sending…"
                  confirm="Send this file to the marketer? You won't be able to edit it until they send it back."
                />
              </div>
            </Card>
          )}

          {member.status === "with_marketer" && (
            <Card title="Marketer review">
              {canMarketerReview ? (
                <div className="space-y-3">
                  <p className="text-sm text-zinc-700">
                    Confirm you know this member and their details below are right. The file then goes back to{" "}
                    {staffName(member.sent_to_marketer_by)} to finish.
                  </p>
                  <div className="flex flex-wrap items-start gap-3">
                    <MarketerReviewForm action={marketerReview.bind(null, member.id)} />
                    <ReturnForm action={returnMember.bind(null, member.id)} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-zinc-700">
                  Sent by {staffName(member.sent_to_marketer_by)} on {formatDateTime(member.sent_to_marketer_at)}.{" "}
                  {isPreparer && can("members.endorse")
                    ? "You prepared this file, so another marketer has to review it."
                    : "Waiting for a marketer to confirm the member."}
                </p>
              )}
            </Card>
          )}

          {member.status === "marketer_reviewed" && (
            <Card title="Send for approval">
              <p className="mb-3 text-sm text-zinc-700">
                Confirmed by {staffName(member.marketer_id)} (marketer) on {formatDateTime(member.marketer_reviewed_at)}
                {member.marketer_note && <>: &ldquo;{member.marketer_note}&rdquo;</>}
              </p>
              {canManage ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  {missing.length > 0 ? (
                    <p className="text-sm text-zinc-700">
                      Upload these before sending the file to the Branch Manager:{" "}
                      <strong>{missing.map((t) => DOCUMENT_TYPES[t]).join(", ")}</strong>.
                    </p>
                  ) : (
                    <p className="text-sm text-zinc-700">All required documents are uploaded. Check the details, then send the file.</p>
                  )}
                  <ActionButton
                    action={submitMember.bind(null, member.id)}
                    label="Send to Branch Manager"
                    pendingLabel="Sending…"
                    confirm="Send this file to the Branch Manager? You won't be able to edit it until it's returned."
                    disabled={missing.length > 0}
                    title={missing.length > 0 ? "Upload the required documents first" : undefined}
                  />
                </div>
              ) : (
                <p className="text-sm text-zinc-700">Waiting for the officer to finish the file and send it to the Branch Manager.</p>
              )}
            </Card>
          )}

          {member.status === "pending_approval" && (
            <Card title="Branch Manager review">
              {canDecide ? (
                <div className="flex flex-wrap items-start gap-6">
                  <ApprovalForm action={approveMember.bind(null, member.id)} />
                  <ReturnForm action={returnMember.bind(null, member.id)} />
                </div>
              ) : (
                <p className="text-sm text-zinc-700">
                  Sent by {staffName(member.submitted_by)} on {formatDateTime(member.submitted_at)}.{" "}
                  {(isPreparer || isReviewingMarketer) && can("members.approve")
                    ? "You worked on this file, so another Branch Manager has to approve it."
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
              <Detail label="Confirmed by marketer">
                {member.marketer_id ? `${staffName(member.marketer_id)}, ${formatDateTime(member.marketer_reviewed_at)}` : null}
              </Detail>
              <Detail label="Approved by">
                {member.approved_by ? `${staffName(member.approved_by)}, ${formatDateTime(member.approved_at)}` : null}
                {member.approval_signature && (
                  // eslint-disable-next-line @next/next/no-img-element -- a stored data URL, not a remote image
                  <img src={member.approval_signature} alt="Branch Manager's signature" className="mt-1 h-12 w-auto" />
                )}
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
                      {d.issued_on ? (
                        <div className="text-xs text-zinc-600">
                          Issued {formatDate(d.issued_on)} ·{" "}
                          {ISSUE_CHANNELS[d.issue_channel as keyof typeof ISSUE_CHANNELS] ?? d.issue_channel} · by{" "}
                          {staffName(d.issued_by)}
                          {d.issue_note && ` · ${d.issue_note}`}
                        </div>
                      ) : (
                        ISSUED_DOCUMENT_TYPES.includes(d.document_type) &&
                        member.status === "approved" && <div className="text-xs text-amber-700">Not issued yet</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {!d.issued_on && ISSUED_DOCUMENT_TYPES.includes(d.document_type) && member.status === "approved" && canManage && (
                        <IssueForm action={recordDocumentIssue.bind(null, member.id, d.id)} />
                      )}
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
            {canManage && (editable || member.status === "approved") && (
              <DocumentUpload
                action={uploadDocument.bind(null, member.id)}
                types={(Object.keys(DOCUMENT_TYPES) as (keyof typeof DOCUMENT_TYPES)[]).filter(
                  (t) => member.status === "approved" || !ISSUED_DOCUMENT_TYPES.includes(t) || t === "signed_agreement_letter",
                )}
              />
            )}
          </Card>

        </>
      )}

      {/* Plans and contributions */}
      {tab === "plans" && (
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
                const p = progress.get(plan.id);
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
                      <dl className="grid grid-cols-3 gap-x-6 gap-y-2 text-right">
                        <Detail label="Total contributed">{formatMoney(t?.total_contributed)}</Detail>
                        <Detail label="Of which top-ups">{formatMoney(t?.total_top_ups)}</Detail>
                        <Detail label="Verified">{formatMoney(t?.total_verified)}</Detail>
                        <Detail label={`Expected to date (${p?.installments_due ?? 0} due)`}>
                          {formatMoney(p?.expected_to_date)}
                        </Detail>
                        <Detail label="Outstanding">
                          <span className={Number(p?.outstanding ?? 0) > 0 ? "font-medium text-red-700" : undefined}>
                            {formatMoney(p?.outstanding)}
                          </span>
                        </Detail>
                        <Detail label="Matures">
                          {p && p.days_to_maturity >= 0 ? `in ${p.days_to_maturity} days` : "Matured"}
                        </Detail>
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

      {tab === "loans" && (
        <Card
          title="Loans"
          actions={
            can("credit.manage") && (
              <ButtonLink href={`/credit/loans/new?member=${member.id}`} variant="secondary">
                New loan application
              </ButtonLink>
            )
          }
        >
          {loans.length === 0 ? (
            <EmptyState>No loans yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {loans.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-4 py-2">
                  <span>
                    <Link href={`/credit/loans/${l.id}`} className="font-mono text-xs underline">
                      {l.loan_no}
                    </Link>{" "}
                    · {l.product_name} · {formatMoney(l.approved_amount ?? l.amount_requested)}
                    {l.status === "active" && (
                      <span className="block text-xs text-zinc-500">
                        Owes {formatMoney(Number(l.outstanding_principal) + Number(l.outstanding_interest))}
                        {l.days_past_due > 0 && <span className="text-red-700"> · {l.days_past_due} days overdue</span>}
                      </span>
                    )}
                  </span>
                  <Badge tone={LOAN_STATUSES[l.status].tone}>{LOAN_STATUSES[l.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
