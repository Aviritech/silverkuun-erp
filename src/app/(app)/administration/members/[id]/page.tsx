import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { LOAN_STATUSES, RATE_BASES, REPAYMENT_FREQUENCIES, type LoanStatus, type RateBasis, type RepaymentFrequency } from "@/modules/credit/constants";
import { FINANCE_STATUSES } from "@/modules/accounts/constants";
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
import { signMemberDocument } from "@/modules/signatures/actions";
import { ESignForm } from "@/modules/signatures/components/e-sign-form";
import { SignatureList } from "@/modules/signatures/components/signature-list";
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
  type DocumentType,
} from "@/modules/administration/constants";
import { administrationModule } from "@/modules/administration/module";
import {
  fullName,
  getMemberBundle,
  getMemberHistory,
  getMemberMoney,
  listBranches,
  listCbnBanks,
  listLiquidations,
} from "@/modules/administration/queries";
import { LiquidationForm } from "@/modules/administration/components/liquidation-form";
import { LIQUIDATION_STATUSES } from "@/modules/administration/constants";
import { requestLiquidation } from "@/modules/administration/actions";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

const RECORD_NAMES: Record<string, string> = {
  members: "Member file",
  member_plans: "Plan",
  contributions: "Contribution",
  member_documents: "Document",
  plan_liquidations: "Liquidation",
  loans: "Loan",
};

/** "Member file: approved", "Plan added", "Contribution changed"... */
function historyLabel(h: { record_type: string; action: string; status: string | null }) {
  const name = RECORD_NAMES[h.record_type] ?? h.record_type;
  if (h.action === "INSERT") return `${name} added${h.status ? ` (${h.status.replaceAll("_", " ")})` : ""}`;
  if (h.action === "DELETE") return `${name} removed`;
  return h.status ? `${name}: ${h.status.replaceAll("_", " ")}` : `${name} changed`;
}

/** Which record a history line is about: loan number, document or plan name, contribution amount. */
function historyDetail(recordType: string, detail: string) {
  if (recordType === "member_documents") return DOCUMENT_TYPES[detail as keyof typeof DOCUMENT_TYPES] ?? detail;
  if (recordType === "contributions") return formatMoney(detail);
  if (recordType === "member_plans") return detail.charAt(0).toUpperCase() + detail.slice(1);
  return detail;
}

/** The four hand-offs a new member file goes through. */
const STEPS = [
  { label: "Officer prepares", statuses: ["draft", "returned"] },
  { label: "Marketer confirms", statuses: ["with_marketer"] },
  { label: "Officer completes", statuses: ["marketer_reviewed"] },
  { label: "Branch Manager approves", statuses: ["pending_approval"] },
] as const;

/** Documents that carry signatures, so can be signed electronically as well as on paper. */
const SIGNABLE_DOCUMENTS: DocumentType[] = ["kyc_form", "signed_agreement_letter", "maturity_letter", "other"];

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
  const { member, documents, documentSignatures, plans, totals, progress, contributions, planTypes, accruedDividends, staffName } = bundle;

  const branch = (await listBranches()).find((b) => b.id === member.branch_id)!;
  const can = (permission: string) => staff.permissions.hasForBranch(permission, branch);
  const editable = OFFICER_EDITABLE.includes(member.status);
  const canManage = can("members.manage");
  // The officer (or the Branch Manager, countersigning) can e-sign documents that carry signatures.
  const canSignDocuments = canManage || can("members.approve");
  const memberName = [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(" ");
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
  // Branch Managers (and Head of Administration, Internal Audit) also see the member's money and the file's history.
  const fullView = can("members.full_view");
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
    interest_rate: string;
    rate_basis: RateBasis;
    tenor_months: number;
    repayment_frequency: RepaymentFrequency;
    overdue_amount: string;
    next_due_date: string | null;
    next_due_amount: string;
    disbursed_on: string | null;
    maturity_date: string | null;
  };
  type LoanGuarantor = {
    id: string;
    loan_id: string;
    full_name: string;
    phone: string;
    relationship: string | null;
    occupation: string | null;
    monthly_income: string | null;
    is_member: boolean;
    confirmed_at: string | null;
  };
  const loanQuery = seesLoans
    ? await (await createClient())
        .from("loan_book")
        .select(
          "id, loan_no, status, product_name, amount_requested, approved_amount, outstanding_principal, outstanding_interest, days_past_due, interest_rate, rate_basis, tenor_months, repayment_frequency, overdue_amount, next_due_date, next_due_amount, disbursed_on, maturity_date",
        )
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
          ...(fullView
            ? [
                { key: "money", label: "Money in and out", href: `/administration/members/${member.id}?tab=money` },
                { key: "history", label: "History", href: `/administration/members/${member.id}?tab=history` },
              ]
            : []),
        ]
      : [];
  const tab = tabs.some((t) => t.key === tabParam) ? tabParam! : "file";
  // Liquidation requests on this member's plans, and the bank list for raising one (Plans tab only).
  const canLiquidate = member.status === "approved" && can("liquidations.request");
  const [liquidations, cbnBanks] =
    tab === "plans" ? await Promise.all([listLiquidations(), canLiquidate ? listCbnBanks() : Promise.resolve([])]) : [[], []];
  const memberLiquidations = liquidations.filter((l) => l.member_id === member.id);
  const approved = member.status === "approved";
  const [money, history, guarantors] = await Promise.all([
    approved && fullView && ["file", "money"].includes(tab) ? getMemberMoney(member.id) : Promise.resolve([]),
    approved && fullView && tab === "history" ? getMemberHistory(member.id) : Promise.resolve([]),
    tab === "loans" && loans.length > 0
      ? (await createClient())
          .from("loan_guarantors")
          .select("id, loan_id, full_name, phone, relationship, occupation, monthly_income, is_member, confirmed_at")
          .in(
            "loan_id",
            loans.map((l) => l.id),
          )
          .order("created_at")
          .then((r) => (r.data ?? []) as LoanGuarantor[])
      : Promise.resolve([] as LoanGuarantor[]),
  ]);
  // Placeholder formula until Kuun confirms it, the same one the interest payment schedule uses:
  // verified savings times the plan's annual rate, divided by 12.
  const monthlyInterest = (planId: string, rate: string | number) =>
    (Number(totals.get(planId)?.total_verified ?? 0) * Number(rate)) / 100 / 12;
  const livePlans = plans.filter((p) => ["active", "matured"].includes(p.status));
  const verifiedSavings = livePlans.reduce((sum, p) => sum + Number(totals.get(p.id)?.total_verified ?? 0), 0);
  const interestPaid = money
    .filter((m) => m.transaction_type === "roi_payment" && m.status === "posted")
    .reduce((sum, m) => sum + Number(m.amount), 0);
  const activeLoans = loans.filter((l) => l.status === "active");
  const loanOwed = activeLoans.reduce((sum, l) => sum + Number(l.outstanding_principal) + Number(l.outstanding_interest), 0);
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
                        ? "bg-neutral-50 text-zinc-700 ring-zinc-200"
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

          {/* At a glance: what the member holds with Kuun, for whoever reviews the file. */}
          {approved && (
            <Card title="At a glance">
              <dl className="grid gap-4 sm:grid-cols-4">
                <Detail label="Verified savings">
                  <span className="text-base font-semibold tabular-nums">{formatMoney(verifiedSavings)}</span>
                </Detail>
                <Detail label={`Open plans (${livePlans.length})`}>
                  {livePlans.length > 0 &&
                    livePlans.map((p) => (
                      <span key={p.id} className="block">
                        {planName.get(p.plan_type) ?? p.plan_type} · {Number(p.interest_rate)}% a year
                      </span>
                    ))}
                </Detail>
                <Detail label="Monthly interest (estimate)">
                  {formatMoney(livePlans.reduce((sum, p) => sum + monthlyInterest(p.id, p.interest_rate), 0))}
                  {fullView && <span className="block text-xs text-zinc-500">Paid to date: {formatMoney(interestPaid)}</span>}
                </Detail>
                {seesLoans && (
                  <Detail label={`Loans (${activeLoans.length} active)`}>
                    {activeLoans.length > 0 && (
                      <>
                        Owes {formatMoney(loanOwed)}
                        {activeLoans.some((l) => l.days_past_due > 0) && (
                          <span className="block text-xs text-red-700">
                            {Math.max(...activeLoans.map((l) => l.days_past_due))} days overdue
                          </span>
                        )}
                      </>
                    )}
                  </Detail>
                )}
              </dl>
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
              <Detail label="Interest paid to">
                {member.bank_account_no &&
                  `${member.bank_name}${member.bank_code ? ` (${member.bank_code})` : ""} · ${member.bank_account_no}`}
                {member.interest_pay_day && <span className="block text-xs text-zinc-500">on day {member.interest_pay_day} of each month</span>}
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
                  <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0 flex-1">
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
                      <SignatureList signatures={documentSignatures.get(d.id) ?? []} staffName={staffName} />
                      {canSignDocuments && SIGNABLE_DOCUMENTS.includes(d.document_type) && (
                        <div className="mt-2">
                          <ESignForm
                            action={signMemberDocument.bind(null, member.id, d.id)}
                            roles={["member", "witness", "staff"]}
                            names={{ member: memberName }}
                            what={`the ${DOCUMENT_TYPES[d.document_type].replace(/^Signed /, "").toLowerCase()}`}
                          />
                        </div>
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
              <p className="mb-2 text-xs text-zinc-500">
                Signed on paper? Upload the signed scan. To sign electronically instead, upload the unsigned document, then use
                &ldquo;Sign electronically&rdquo; on it.
              </p>
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
                          {formatDate(plan.start_date)} to {formatDate(plan.maturity_date)} · {Number(plan.interest_rate)}% a year · {plan.status}
                        </p>
                        {plan.dividends_at_maturity && (
                          <p className="text-xs text-zinc-500">Dividends build up and are paid with the savings at maturity.</p>
                        )}
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
                        <Detail label="Interest rate">{Number(plan.interest_rate)}% a year</Detail>
                        <Detail label="Monthly interest (estimate)">{formatMoney(monthlyInterest(plan.id, plan.interest_rate))}</Detail>
                        {plan.dividends_at_maturity && (
                          <>
                            <Detail label="Dividends so far">{formatMoney(accruedDividends.get(plan.id))}</Detail>
                            <Detail label="Due at maturity so far">
                              {formatMoney(Number(t?.total_verified ?? 0) + Number(accruedDividends.get(plan.id) ?? 0))}
                            </Detail>
                          </>
                        )}
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
                        <ContributionForm action={recordContribution.bind(null, member.id)} planId={plan.id} />
                        <ButtonLink href="/administration/top-ups" variant="secondary">
                          Top ups from Accounts
                        </ButtonLink>
                      </div>
                    )}
                    {(() => {
                      const planLiquidations = memberLiquidations.filter((l) => l.member_plan_id === plan.id);
                      const open = planLiquidations.find((l) => ["pending_approval", "returned", "approved"].includes(l.status));
                      const paid = planLiquidations.find((l) => l.status === "paid");
                      if (open || paid) {
                        const l = (open ?? paid)!;
                        return (
                          <p className="flex flex-wrap items-center gap-2 border-t border-zinc-100 p-4 text-sm">
                            Liquidation <span className="font-mono text-xs">{l.liquidation_no}</span> · {formatMoney(l.amount)}
                            <Badge tone={LIQUIDATION_STATUSES[l.status].tone}>{LIQUIDATION_STATUSES[l.status].label}</Badge>
                            <Link href="/administration/liquidations" className="text-xs underline">
                              Liquidations
                            </Link>
                          </p>
                        );
                      }
                      if (!canLiquidate || !["active", "matured"].includes(plan.status)) return null;
                      return (
                        <div className="border-t border-zinc-100 p-4">
                          <LiquidationForm
                            action={requestLiquidation.bind(null, plan.id, null)}
                            banks={cbnBanks}
                            savings={t?.total_verified ?? "0"}
                            defaults={{
                              amount: t?.total_verified ? String(t.total_verified) : "",
                              beneficiary_account_name: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(" "),
                              bank_code: member.bank_code,
                              bank_name: member.bank_name,
                              bank_account_no: member.bank_account_no,
                            }}
                          />
                        </div>
                      );
                    })()}
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
            <div className="space-y-4">
              {loans.map((l) => {
                const lg = guarantors.filter((g) => g.loan_id === l.id);
                return (
                  <div key={l.id} className="rounded-lg border border-zinc-200 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 p-4">
                      <div>
                        <p className="font-medium">
                          <Link href={`/credit/loans/${l.id}`} className="font-mono text-xs underline">
                            {l.loan_no}
                          </Link>{" "}
                          · {l.product_name} · {formatMoney(l.approved_amount ?? l.amount_requested)}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {Number(l.interest_rate)}
                          {RATE_BASES[l.rate_basis]} · {l.tenor_months} months · repaid{" "}
                          {REPAYMENT_FREQUENCIES[l.repayment_frequency]?.toLowerCase() ?? l.repayment_frequency}
                          {l.disbursed_on && <> · paid out {formatDate(l.disbursed_on)}</>}
                          {l.maturity_date && <> · ends {formatDate(l.maturity_date)}</>}
                        </p>
                      </div>
                      <Badge tone={LOAN_STATUSES[l.status].tone}>{LOAN_STATUSES[l.status].label}</Badge>
                    </div>
                    {l.status === "active" && (
                      <dl className="grid grid-cols-2 gap-4 border-b border-zinc-100 p-4 sm:grid-cols-4">
                        <Detail label="Principal owed">{formatMoney(l.outstanding_principal)}</Detail>
                        <Detail label="Interest owed">{formatMoney(l.outstanding_interest)}</Detail>
                        <Detail label="Overdue">
                          <span className={Number(l.overdue_amount) > 0 ? "font-medium text-red-700" : undefined}>
                            {formatMoney(l.overdue_amount)}
                            {l.days_past_due > 0 && ` · ${l.days_past_due} days`}
                          </span>
                        </Detail>
                        <Detail label="Next repayment">
                          {l.next_due_date && `${formatMoney(l.next_due_amount)} on ${formatDate(l.next_due_date)}`}
                        </Detail>
                      </dl>
                    )}
                    <div className="p-4">
                      <p className="mb-2 text-xs font-medium text-zinc-500">Guarantors</p>
                      {lg.length === 0 ? (
                        <p className="text-zinc-500">None</p>
                      ) : (
                        <ul className="space-y-1">
                          {lg.map((g) => (
                            <li key={g.id} className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{g.full_name}</span>
                              <span className="text-zinc-500">
                                {[g.relationship, g.occupation, g.phone, g.monthly_income && `earns ${formatMoney(g.monthly_income)} a month`]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              {g.is_member && <Badge tone="blue">Member</Badge>}
                              {g.confirmed_at ? <Badge tone="green">Confirmed</Badge> : <Badge tone="amber">Not confirmed</Badge>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === "money" && (
        <Card title="Money in and out">
          <p className="mb-4 text-sm text-zinc-600">
            Everything Accounts has recorded for this member past draft: savings received, interest paid, liquidation payouts, loan
            disbursements and repayments.
          </p>
          {money.length === 0 ? (
            <EmptyState>Nothing recorded yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium">What</th>
                    <th className="px-3 py-2 text-right font-medium">In</th>
                    <th className="px-3 py-2 text-right font-medium">Out</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {money.map((m) => (
                    <tr key={m.id} className="border-t border-zinc-100 align-top">
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(m.txn_date)}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{m.txn_no}</span>
                        {m.reference && <div className="font-mono text-xs text-zinc-500">{m.reference}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {m.type_name}
                        <div className="text-xs text-zinc-500">
                          {[
                            m.plan_name && `${m.plan_name} plan`,
                            m.loan_no && `Loan ${m.loan_no}`,
                            m.liquidation_no && `Liquidation ${m.liquidation_no}`,
                            Number(m.interest_amount) > 0 && `of which interest ${formatMoney(m.interest_amount)}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {m.direction === "receipt" ? formatMoney(m.amount) : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {m.direction === "payment" ? formatMoney(m.amount) : ""}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={FINANCE_STATUSES[m.status].tone}>{FINANCE_STATUSES[m.status].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "history" && (
        <Card title="History">
          <p className="mb-4 text-sm text-zinc-600">
            Every change to this member&apos;s file, plans, contributions, documents, liquidations
            {seesLoans ? " and loans" : ""}, newest first.
          </p>
          {history.length === 0 ? (
            <EmptyState>No changes recorded.</EmptyState>
          ) : (
            <ol className="divide-y divide-zinc-100 text-sm">
              {history.map((h, i) => (
                <li key={`${h.record_id}-${h.occurred_at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{historyLabel(h)}</span>
                    {h.detail && <span className="text-zinc-500"> · {historyDetail(h.record_type, h.detail)}</span>}
                    {h.action === "UPDATE" && h.changed_fields && h.changed_fields.length > 0 && !h.status && (
                      <span className="text-zinc-500"> · changed {h.changed_fields.map((f) => f.replaceAll("_", " ")).join(", ")}</span>
                    )}
                    <span className="block text-xs text-zinc-500">by {h.actor_name ?? "the system"}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-zinc-500">{formatDateTime(h.occurred_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
