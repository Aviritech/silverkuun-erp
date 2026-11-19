import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import {
  addCollateral,
  addGuarantor,
  appraiseLoan,
  businessDecideLoan,
  cancelLoan,
  confirmGuarantor,
  recordChecklist,
  decideLoan,
  decideRestructure,
  reassignOfficer,
  recordReminder,
  removeLoanPart,
  requestRestructure,
  returnLoan,
  submitLoan,
  uploadLoanDocument,
} from "@/modules/credit/actions";
import {
  AppraisalForm,
  BusinessDecisionForm,
  ChecklistForm,
  CollateralForm,
  ConfirmGuarantorForm,
  DecisionForm,
  GuarantorForm,
  LoanDocumentUpload,
  ReassignForm,
  ReminderForm,
  RestructureDecisionForm,
  RestructureForm,
} from "@/modules/credit/components/forms";
import {
  BUREAU_RESULTS,
  COLLATERAL_TYPES,
  CUSTOMER_CATEGORIES,
  INSTALLMENT_STATUSES,
  INTEREST_METHODS,
  LOAN_DOCUMENT_TYPES,
  LOAN_STATUSES,
  RATE_BASES,
  REMINDER_CHANNELS,
  REPAYMENT_FREQUENCIES,
  REPAYMENT_MODES,
  RISK_RATINGS,
  arrearsBucket,
  type LoanDocumentType,
} from "@/modules/credit/constants";
import { creditModule } from "@/modules/credit/module";
import {
  CHECKLISTS,
  CHECKLIST_ANSWERS,
  FORMS,
  KYC_RECOMMENDATIONS,
  KYC_STATUSES,
  MIN_EQUITY_SHARE,
  VERIFICATION_METHODS,
  displayValue,
  equityShare,
  isKuunForm,
  type FormDetails,
  type FormSection,
} from "@/modules/credit/loan-forms";
import { getLoanBundle, listOfficers, officersFor } from "@/modules/credit/queries";
import { signGuarantee, signLoanDocument } from "@/modules/signatures/actions";
import { ESignForm } from "@/modules/signatures/components/e-sign-form";
import { SignatureList } from "@/modules/signatures/components/signature-list";
import type { SignerRole } from "@/modules/signatures/constants";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${tone === "red" ? "text-red-700" : "text-ink"}`}>{value}</p>
    </div>
  );
}

/** Documents that carry signatures, so can be signed electronically as well as on paper. */
const SIGNABLE_DOCUMENTS: LoanDocumentType[] = [
  "application_form",
  "guarantor_form",
  "offer_letter",
  "collateral_document",
  "direct_debit_mandate",
  "guarantor_mandate",
  "sale_of_assets_agreement",
  "gsi_mandate",
  "other",
];

/** The answers on one of Kuun's forms, section by section. */
function FormDetailsView({ sections, details }: { sections: FormSection[]; details: FormDetails }) {
  const filled = sections.filter((s) => s.fields.some((f) => details[f.key]));
  if (filled.length === 0) return null;
  return (
    <div className="mt-4 space-y-3 border-t border-zinc-100 pt-3">
      {filled.map((s) => (
        <div key={s.title}>
          <p className="mb-1 text-xs font-semibold text-zinc-600">{s.title}</p>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
            {s.fields
              .filter((f) => details[f.key])
              .map((f) => (
                <Detail key={f.key} label={f.label.replace(/ \(₦\)$/, "")}>
                  {displayValue(f, details[f.key], formatMoney, formatDate)}
                </Detail>
              ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

const APPLICATION_DOCUMENTS: LoanDocumentType[] = [
  "application_form",
  "proforma_invoice",
  "bank_statement",
  "payslip",
  "guarantor_form",
  "collateral_document",
  "credit_bureau_report",
  "utility_bill",
  "id_document",
  "passport_photo",
  "employment_letter",
  "direct_debit_mandate",
  "guarantor_id",
  "guarantor_mandate",
  "mortgage_deed",
  "cheque_leaves",
  "sale_of_assets_agreement",
  "insurance_evidence",
  "gsi_mandate",
  "equity_evidence",
  "other",
];

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(creditModule);
  const { id } = await params;
  const [bundle, org, officers] = await Promise.all([getLoanBundle(id), listOrg(), listOfficers()]);
  if (!bundle) notFound();
  const { loan, position, member, memberName, product, guarantors, collaterals, documents, schedule, repayments, restructures, reminders, otherLoans, documentSignatures, guarantorSignatures, staffName, checklist, review } =
    bundle;
  const branch = org.branches.find((b) => b.id === loan.branch_id)!;
  const can = (p: string) => staff.permissions.hasForBranch(p, branch);
  const status = LOAN_STATUSES[loan.status];
  const formCode = isKuunForm(product.application_form) ? product.application_form : null;
  const form = formCode ? FORMS[formCode] : null;
  const lines = formCode ? CHECKLISTS[formCode] : [];
  const answers = new Map(checklist.map((c) => [c.item_code, c]));
  const checklistDone = !!review && lines.every((l) => !l.required || answers.get(l.item)?.answer === "yes");
  const equity = formCode === "kuun_asset" ? equityShare(loan.form_details) : null;

  const editable = ["draft", "returned"].includes(loan.status);
  const canManage = can("credit.manage");
  const isPreparer = loan.created_by === staff.id || loan.submitted_by === staff.id || loan.account_officer_id === staff.id;
  const canAppraise = loan.status === "submitted" && can("credit.appraise") && !isPreparer;
  const canDecide = loan.status === "appraised" && can("credit.approve") && !isPreparer && loan.appraised_by !== staff.id;
  const canBusinessDecide =
    loan.status === "credit_approved" &&
    can("credit.business_approve") &&
    !isPreparer &&
    ![loan.appraised_by, loan.approved_by].includes(staff.id);
  const canReturn = (loan.status === "submitted" && canAppraise) || canDecide || canBusinessDecide;
  const unconfirmed = guarantors.filter((g) => !g.confirmed_at);
  const canCancel = (editable && canManage) || (loan.status === "approved" && can("credit.approve"));
  const pendingRestructure = restructures.find((r) => r.status === "pending");
  const live = ["active", "closed"].includes(loan.status);
  // E-signatures: guarantors sign their guarantee before appraisal; signed documents can be e-signed at any stage.
  const canSignGuarantee = (editable && canManage) || (loan.status === "submitted" && can("credit.appraise"));
  const canSignDocuments = canManage || can("credit.appraise") || can("credit.approve");
  const signerRoles = (type: LoanDocumentType): SignerRole[] =>
    type === "guarantor_form" ? ["guarantor", "witness", "staff"] : ["member", "guarantor", "witness", "staff"];

  const uploadTypes: LoanDocumentType[] = editable
    ? canManage
      ? APPLICATION_DOCUMENTS
      : can("credit.appraise")
        ? ["credit_bureau_report"]
        : []
    : loan.status === "submitted" && can("credit.appraise")
      ? ["credit_bureau_report"]
      : ["approved", "active", "closed"].includes(loan.status) && canManage
        ? ["offer_letter", "other"]
        : [];

  const missing: string[] = [];
  if (editable) {
    if (!documents.some((d) => d.document_type !== "credit_bureau_report")) missing.push("at least one supporting document");
    if (product.requires_proforma && !documents.some((d) => d.document_type === "proforma_invoice")) missing.push("the proforma invoice");
    if (product.requires_guarantor && guarantors.length < product.min_guarantors)
      missing.push(product.min_guarantors > 1 ? `${product.min_guarantors} guarantors` : "a guarantor");
    if (form && !documents.some((d) => d.document_type === "application_form")) missing.push(`the signed ${form.name} application form`);
    if (product.requires_collateral && collaterals.length === 0) missing.push("the collateral");
  }

  const nextDue = schedule.find((i) => i.status !== "paid");
  const overdue = position && Number(position.overdue_amount) > 0;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={`Loan ${loan.loan_no}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <Link href={`/administration/members/${member.id}`} className="underline">
              {memberName}
            </Link>
            <span>· {product.name}</span>
            <span>· {branch.name}</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {form && (
              <ButtonLink href={`/letters/loans/${loan.id}/application`} variant="secondary">
                Print application form
              </ButtonLink>
            )}
            {form && (
              <ButtonLink href={`/letters/loans/${loan.id}/checklist`} variant="secondary">
                Print checklist
              </ButtonLink>
            )}
            {["approved", "active", "closed"].includes(loan.status) && (
              <ButtonLink href={`/letters/loans/${loan.id}`} variant="secondary">
                Offer letter
              </ButtonLink>
            )}
            {editable && canManage && (
              <ButtonLink href={`/credit/loans/${loan.id}/edit`} variant="secondary">
                Edit application
              </ButtonLink>
            )}
          </div>
        }
      />

      {loan.decision_reason && ["returned", "rejected", "cancelled"].includes(loan.status) && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">{loan.status === "returned" ? "Returned for correction" : loan.status === "rejected" ? "Rejected" : "Cancelled"}</p>
          <p className="mt-1">{loan.decision_reason}</p>
        </div>
      )}

      {live && position && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Total expected" value={formatMoney(position.total_expected)} />
          <Stat label="Principal repaid" value={formatMoney(position.principal_repaid)} />
          <Stat label="Interest repaid" value={formatMoney(position.interest_repaid)} />
          <Stat
            label="Outstanding"
            value={formatMoney(Number(position.outstanding_principal) + Number(position.outstanding_interest) + Number(position.penalty_outstanding))}
          />
          <Stat label="Overdue" value={formatMoney(position.overdue_amount)} tone={overdue ? "red" : undefined} />
          <Stat
            label={`Late penalty owed (${Number(position.late_penalty_rate)}% a day)`}
            value={formatMoney(position.penalty_outstanding)}
            tone={Number(position.penalty_outstanding) > 0 ? "red" : undefined}
          />
          <Stat label="Penalty paid" value={formatMoney(position.penalty_repaid)} />
          <Stat label="Missed repayments" value={String(position.missed_repayments)} tone={position.missed_repayments > 0 ? "red" : undefined} />
          <Stat
            label="Next repayment"
            value={position.next_due_date ? `${formatMoney(position.next_due_amount)} on ${formatDate(position.next_due_date)}` : "—"}
          />
          <Stat label="Remaining tenor" value={`${position.remaining_installments} of ${schedule.length} · matures ${formatDate(loan.maturity_date)}`} />
        </div>
      )}
      {live && position && position.days_past_due > 0 && (
        <p className="text-sm text-red-800">
          {position.days_past_due} days past due ({arrearsBucket(position.days_past_due).label}).
          {position.last_paid_on ? ` Last paid ${formatDate(position.last_paid_on)}.` : " Nothing paid yet."}
        </p>
      )}

      <Card title="Where it stands">
        <ol className="space-y-1 text-sm">
          <li>Prepared by {staffName(loan.created_by)} on {formatDateTime(loan.created_at)}</li>
          {loan.submitted_at && <li>Submitted by {staffName(loan.submitted_by)} on {formatDateTime(loan.submitted_at)}</li>}
          {loan.appraised_at && <li>Appraised by {staffName(loan.appraised_by)} on {formatDateTime(loan.appraised_at)}</li>}
          {loan.approved_at && (
            <li>
              Approved for {formatMoney(loan.approved_amount)} by {staffName(loan.approved_by)} (Head of Credit) on{" "}
              {formatDateTime(loan.approved_at)}
            </li>
          )}
          {loan.business_approved_at && (
            <li>
              Approved by {staffName(loan.business_approved_by)} (Head of Business) on {formatDateTime(loan.business_approved_at)}
              {loan.business_note && `: ${loan.business_note}`}
            </li>
          )}
          {loan.decided_at && !loan.approved_at && (
            <li>
              Decided by {staffName(loan.decided_by)} on {formatDateTime(loan.decided_at)}
            </li>
          )}
          {loan.disbursement_txn_no && (
            <li>
              Disbursement {loan.disbursement_txn_no} in Accounts: {loan.disbursement_status}
              {loan.disbursed_on && `, paid out on ${formatDate(loan.disbursed_on)}`}
            </li>
          )}
          {loan.closed_on && <li>Fully repaid on {formatDate(loan.closed_on)}</li>}
        </ol>
        {loan.approval_note && <p className="mt-2 text-sm text-zinc-600">Approval note: {loan.approval_note}</p>}

        <div className="mt-4 flex flex-wrap items-start gap-3">
          {editable && canManage && (
            <ActionButton
              action={submitLoan.bind(null, loan.id)}
              label="Submit for appraisal"
              pendingLabel="Submitting…"
              disabled={missing.length > 0}
              title={missing.length ? `Add ${missing.join(", ")} first.` : undefined}
            />
          )}
          {loan.status === "submitted" && isPreparer && <p className="text-sm text-zinc-600">Waiting for a credit analyst to appraise it.</p>}
          {loan.status === "appraised" && !canDecide && <p className="text-sm text-zinc-600">Waiting for the Head of Credit to decide.</p>}
          {loan.status === "credit_approved" && !canBusinessDecide && (
            <p className="text-sm text-zinc-600">Approved by the Head of Credit and waiting for the Head of Business.</p>
          )}
          {loan.status === "approved" && (
            <p className="text-sm text-zinc-600">
              Approved and waiting for Accounts to pay it out (Internal Audit approves the payment first)
              {loan.disbursement_txn_no ? ` (${loan.disbursement_txn_no}, ${loan.disbursement_status})` : ""}.
            </p>
          )}
          {canReturn && (
            <ReasonForm action={returnLoan.bind(null, loan.id)} openLabel="Return to officer" submitLabel="Return" question="What needs correcting?" variant="secondary" />
          )}
          {canCancel && (
            <ReasonForm action={cancelLoan.bind(null, loan.id)} openLabel="Cancel application" submitLabel="Cancel it" question="Why is it being cancelled?" />
          )}
          {["draft", "returned", "submitted", "appraised", "credit_approved", "approved", "active"].includes(loan.status) && can("credit.approve") && (
            <ReassignForm action={reassignOfficer.bind(null, loan.id)} officers={officersFor(officers, branch)} current={loan.account_officer_id} />
          )}
        </div>
        {editable && canManage && missing.length > 0 && <p className="mt-2 text-sm text-amber-800">Before submitting, add {missing.join(", ")}.</p>}
      </Card>

      {canAppraise && (
        <Card title="Credit appraisal">
          {form && !checklistDone ? (
            <p className="text-sm text-amber-800">
              Complete the compliance checklist below, with every required line Yes, before recording the appraisal. If a document is
              missing, return the application to the account officer.
            </p>
          ) : unconfirmed.length > 0 ? (
            <p className="text-sm text-amber-800">
              Confirm {unconfirmed.length === 1 ? "the guarantor" : `all ${unconfirmed.length} guarantors`} below before recording the
              appraisal.
            </p>
          ) : (
            <AppraisalForm action={appraiseLoan.bind(null, loan.id)} amountRequested={loan.amount_requested} />
          )}
        </Card>
      )}

      {loan.appraised_at && (
        <Card title="Appraisal">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label="Credit bureau">
              {loan.bureau_check && BUREAU_RESULTS[loan.bureau_check]}
              {(loan.bureau_name || loan.bureau_score) && (
                <span className="block text-xs text-zinc-500">{[loan.bureau_name, loan.bureau_score].filter(Boolean).join(" · ")}</span>
              )}
            </Detail>
            <Detail label="Risk rating">{loan.risk_rating && <Badge tone={RISK_RATINGS[loan.risk_rating].tone}>{RISK_RATINGS[loan.risk_rating].label}</Badge>}</Detail>
            <Detail label="Recommendation">
              {loan.recommendation === "approve" ? `Approve ${formatMoney(loan.recommended_amount)}` : loan.recommendation === "decline" ? "Decline" : ""}
            </Detail>
            <div className="sm:col-span-3">
              <Detail label="Notes">
                <span className="whitespace-pre-line">{loan.appraisal_notes}</span>
              </Detail>
            </div>
          </dl>
        </Card>
      )}

      {canBusinessDecide && (
        <Card title="Head of Business approval">
          <p className="mb-3 text-sm text-zinc-700">
            The Head of Credit approved {formatMoney(loan.approved_amount)}. Approving sends it to Accounts to pay out.
          </p>
          <BusinessDecisionForm action={businessDecideLoan.bind(null, loan.id)} />
        </Card>
      )}

      {canDecide && (
        <Card title="Head of Credit decision">
          <DecisionForm action={decideLoan.bind(null, loan.id)} recommendedAmount={loan.recommended_amount ?? loan.amount_requested} />
        </Card>
      )}

      <Card title="Application">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Amount requested">
            <span className="text-base font-semibold">{formatMoney(loan.amount_requested)}</span>
            {loan.approved_amount && <span className="block text-xs text-zinc-500">Approved {formatMoney(loan.approved_amount)}</span>}
          </Detail>
          <Detail label="Duration">
            {loan.tenor_months} months, {REPAYMENT_FREQUENCIES[loan.repayment_frequency].toLowerCase()}
          </Detail>
          <Detail label="Interest">
            {Number(loan.interest_rate)}
            {RATE_BASES[loan.rate_basis]}, {INTEREST_METHODS[loan.interest_method].toLowerCase()}
          </Detail>
          <Detail label="Repayment method">{REPAYMENT_MODES[loan.repayment_mode]}</Detail>
          <Detail label="First repayment">{loan.first_repayment_date ? formatDate(loan.first_repayment_date) : "One period after disbursement"}</Detail>
          <Detail label="Account officer">{staffName(loan.account_officer_id)}</Detail>
          <Detail label="Customer">
            {memberName}
            {member.membership_no && <span className="block font-mono text-xs text-zinc-500">{member.membership_no}</span>}
          </Detail>
          <Detail label="Phone">{loan.phone}</Detail>
          <Detail label="Address">
            {loan.address}
            {loan.address_landmark && <span className="block text-xs text-zinc-500">Landmark: {loan.address_landmark}</span>}
          </Detail>
          <Detail label="Category">{CUSTOMER_CATEGORIES[loan.customer_category]}</Detail>
          <Detail label="Employer or business">
            {loan.employer_name}
            {loan.occupation && <span className="block text-xs text-zinc-500">{loan.occupation}</span>}
            {loan.employer_address && <span className="block text-xs text-zinc-500">{loan.employer_address}</span>}
          </Detail>
          <Detail label="Monthly income">{loan.monthly_income && formatMoney(loan.monthly_income)}</Detail>
          <div className="sm:col-span-3">
            <Detail label="Purpose">{loan.purpose}</Detail>
          </div>
        </dl>
        {form && <FormDetailsView sections={form.application} details={loan.form_details} />}
        {equity !== null && (
          <p className={`mt-3 text-sm ${equity < MIN_EQUITY_SHARE && loan.form_details.equity_applicable === "yes" ? "text-red-700" : "text-zinc-600"}`}>
            Equity contribution is {Math.round(equity * 100)}% of the asset&rsquo;s cost
            {loan.form_details.equity_applicable === "yes" && equity < MIN_EQUITY_SHARE && `, below the ${MIN_EQUITY_SHARE * 100}% minimum`}.
          </p>
        )}
      </Card>

      <Card
        title={
          product.requires_guarantor
            ? `Guarantors (${product.min_guarantors > 1 ? `${product.min_guarantors} required` : "required"})`
            : "Guarantors"
        }
        actions={
          form && (
            <Link href={`/letters/loan-forms/${formCode}/guarantor`} className="text-sm underline">
              Blank guarantor form
            </Link>
          )
        }
      >
        {guarantors.length === 0 ? (
          <EmptyState>No guarantors yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {guarantors.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-4 py-2">
                <span>
                  <span className="font-medium">{g.full_name}</span>
                  {g.relationship && <span className="text-zinc-500"> · {g.relationship}</span>}
                  {g.is_member && (
                    <span className="ml-2">
                      <Badge tone="blue">Member</Badge>
                    </span>
                  )}
                  <span className="block text-xs text-zinc-500">
                    {[g.phone, g.address, g.occupation, g.employer, g.monthly_income && `${formatMoney(g.monthly_income)} a month`].filter(Boolean).join(" · ")}
                  </span>
                  {form && (
                    <span className="mt-1 block text-xs">
                      {form.guarantor
                        .flatMap((s) => s.fields)
                        .filter((f) => g.form_details[f.key])
                        .map((f) => `${f.label.replace(/ \(.*\)$/, "")}: ${displayValue(f, g.form_details[f.key], formatMoney, formatDate)}`)
                        .join(" · ")}{" "}
                      <Link href={`/letters/loans/${loan.id}/guarantors/${g.id}`} className="whitespace-nowrap underline">
                        Print guarantor form
                      </Link>
                    </span>
                  )}
                  {g.confirmed_at ? (
                    <span className="mt-1 block text-xs text-emerald-800">
                      Confirmed by {staffName(g.confirmed_by)} on {formatDateTime(g.confirmed_at)}: {g.confirmation_note}
                    </span>
                  ) : (
                    !editable && <span className="mt-1 block text-xs text-amber-800">Not confirmed yet</span>
                  )}
                  {guarantorSignatures.get(g.id) ? (
                    <SignatureList signatures={guarantorSignatures.get(g.id)!} staffName={staffName} />
                  ) : (
                    canSignGuarantee && (
                      <span className="mt-2 block">
                        <ESignForm
                          action={signGuarantee.bind(null, loan.id, g.id)}
                          roles={["guarantor"]}
                          names={{ guarantor: g.full_name }}
                          label="Guarantor signs electronically"
                          what={`the guarantee for loan ${loan.loan_no}`}
                        />
                      </span>
                    )
                  )}
                  {!g.confirmed_at && canAppraise && (
                    <span className="mt-2 block">
                      <ConfirmGuarantorForm action={confirmGuarantor.bind(null, loan.id, g.id)} />
                    </span>
                  )}
                </span>
                {editable && canManage && (
                  <ActionButton action={removeLoanPart.bind(null, loan.id, "loan_guarantors", g.id)} label="Remove" variant="secondary" confirm="Remove this guarantor?" />
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && canManage && (
          <div className="mt-4">
            <GuarantorForm action={addGuarantor.bind(null, loan.id)} sections={form?.guarantor} />
          </div>
        )}
      </Card>

      <Card title={product.requires_collateral ? "Collateral (required)" : "Collateral"}>
        {collaterals.length === 0 ? (
          <EmptyState>No collateral recorded.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {collaterals.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-4 py-2">
                <span>
                  <span className="font-medium">{COLLATERAL_TYPES[c.collateral_type]}</span> · {c.description}
                  <span className="block text-xs text-zinc-500">
                    Valued at {formatMoney(c.estimated_value)}
                    {c.valued_by && ` by ${c.valued_by}`}
                    {c.valuation_date && ` on ${formatDate(c.valuation_date)}`}
                  </span>
                </span>
                {editable && canManage && (
                  <ActionButton action={removeLoanPart.bind(null, loan.id, "loan_collaterals", c.id)} label="Remove" variant="secondary" confirm="Remove this collateral?" />
                )}
              </li>
            ))}
            <li className="py-2 text-xs text-zinc-500">
              Total {formatMoney(collaterals.reduce((s, c) => s + Number(c.estimated_value), 0))}, covering{" "}
              {Math.round((collaterals.reduce((s, c) => s + Number(c.estimated_value), 0) / Number(loan.approved_amount ?? loan.amount_requested)) * 100)}% of the loan
            </li>
          </ul>
        )}
        {editable && canManage && (
          <div className="mt-4">
            <CollateralForm action={addCollateral.bind(null, loan.id)} />
          </div>
        )}
      </Card>

      {form && loan.status !== "draft" && (
        <Card title={`Compliance checklist (${form.name})`}>
          {canAppraise ? (
            <>
              <p className="mb-3 text-sm text-zinc-600">
                Tick each document Yes once you have seen it (uploaded here or on paper). Every required line must be Yes before the
                appraisal; if something is missing, answer No with a remark and return the application to the account officer.
              </p>
              <ChecklistForm
                action={recordChecklist.bind(null, loan.id)}
                lines={lines}
                uploaded={[...new Set(documents.map((d) => d.document_type))]}
                previous={Object.fromEntries(checklist.map((c) => [c.item_code, { answer: c.answer, remark: c.remark }]))}
                askKyc={formCode === "kuun_asset"}
              />
            </>
          ) : !review ? (
            <EmptyState>
              {loan.status === "submitted"
                ? "Waiting for the credit analyst to do the compliance checklist."
                : "The checklist is done again each time the application is sent for appraisal."}
            </EmptyState>
          ) : null}
          {review && (
            <div className={canAppraise ? "mt-6 border-t border-zinc-100 pt-4" : undefined}>
              <p className="mb-2 text-xs text-zinc-500">
                Recorded by {staffName(review.reviewed_by)} on {formatDateTime(review.reviewed_at)}
                {review.verification_methods.length > 0 &&
                  ` · verified by ${review.verification_methods.map((m) => VERIFICATION_METHODS[m].toLowerCase()).join(", ")}`}
                {review.kyc_status && ` · KYC ${KYC_STATUSES[review.kyc_status].toLowerCase()}`}
                {review.kyc_recommendation && `, ${KYC_RECOMMENDATIONS[review.kyc_recommendation].toLowerCase()}`}
              </p>
              <ul className="divide-y divide-zinc-100 text-sm">
                {lines.map((l) => {
                  const a = answers.get(l.item);
                  return (
                    <li key={l.item} className="flex items-start justify-between gap-4 py-1.5">
                      <span>
                        {l.label}
                        {a?.remark && <span className="block text-xs text-zinc-500">{a.remark}</span>}
                      </span>
                      <Badge tone={a?.answer === "yes" ? "green" : a?.answer === "no" ? "red" : "gray"}>
                        {a ? CHECKLIST_ANSWERS[a.answer] : "Not answered"}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
              {review.note && <p className="mt-2 text-sm text-zinc-600">{review.note}</p>}
            </div>
          )}
        </Card>
      )}

      <Card title="Documents">
        {product.requires_proforma && <p className="mb-2 text-sm text-zinc-600">This product needs a proforma invoice for the asset being financed.</p>}
        {documents.length === 0 ? (
          <EmptyState>No documents yet.</EmptyState>
        ) : (
          <ul className="mb-4 divide-y divide-zinc-100 text-sm">
            {documents.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{LOAN_DOCUMENT_TYPES[d.document_type]}</span> · {d.file_name}
                  <span className="block text-xs text-zinc-500">
                    {staffName(d.uploaded_by)}, {formatDateTime(d.uploaded_at)}
                  </span>
                  <SignatureList signatures={documentSignatures.get(d.id) ?? []} staffName={staffName} />
                  {canSignDocuments && SIGNABLE_DOCUMENTS.includes(d.document_type) && (
                    <span className="mt-2 block">
                      <ESignForm
                        action={signLoanDocument.bind(null, loan.id, d.id)}
                        roles={signerRoles(d.document_type)}
                        names={{ member: memberName, guarantor: guarantors[0]?.full_name }}
                        what={`the ${LOAN_DOCUMENT_TYPES[d.document_type].replace(/^Signed /, "").toLowerCase()}`}
                      />
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="underline">
                      View
                    </a>
                  ) : (
                    <span className="text-xs text-zinc-500">File not available</span>
                  )}
                  {editable && canManage && (
                    <ActionButton action={removeLoanPart.bind(null, loan.id, "loan_documents", d.id)} label="Remove" variant="secondary" confirm="Remove this document?" />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {uploadTypes.length > 0 && canSignDocuments && (
          <p className="mb-2 text-xs text-zinc-500">
            Signed on paper? Upload the signed scan. To sign electronically instead, upload the unsigned document, then use
            &ldquo;Sign electronically&rdquo; on it.
          </p>
        )}
        {uploadTypes.length > 0 && <LoanDocumentUpload action={uploadLoanDocument.bind(null, loan.id)} types={uploadTypes} />}
      </Card>

      {schedule.length > 0 && (
        <Card title={loan.schedule_version > 1 ? `Repayment schedule (restructured, version ${loan.schedule_version})` : "Repayment schedule"}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1 font-medium">#</th>
                  <th className="py-1 font-medium">Due</th>
                  <th className="py-1 text-right font-medium">Principal</th>
                  <th className="py-1 text-right font-medium">Interest</th>
                  <th className="py-1 text-right font-medium">Paid</th>
                  <th className="py-1 text-right font-medium">Outstanding</th>
                  <th className="py-1 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((i) => (
                  <tr key={i.id} className={`border-t border-zinc-100 ${i.id === nextDue?.id ? "bg-neutral-50/70" : ""}`}>
                    <td className="py-1.5">{i.installment_no}</td>
                    <td className="py-1.5">{formatDate(i.due_date)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(i.principal_due)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(i.interest_due)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(Number(i.principal_paid) + Number(i.interest_paid))}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(i.outstanding)}</td>
                    <td className="py-1.5 pl-4">
                      <Badge tone={INSTALLMENT_STATUSES[i.status].tone}>{INSTALLMENT_STATUSES[i.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {live && (
        <Card
          title="Repayments"
          actions={
            loan.status === "active" &&
            can("accounts.receipts.record") && (
              <Link href={`/accounts/transactions/new?direction=receipt&loan=${loan.id}`} className="text-sm underline">
                Record a repayment in Accounts
              </Link>
            )
          }
        >
          <p className="mb-3 text-xs text-zinc-500">
            Repayments are receipted by Accounts against this loan. Each one pays the overdue instalments first (oldest first, interest
            before principal), then any late penalty, then the instalments not yet due.
          </p>
          {repayments.length === 0 ? (
            <EmptyState>No repayments yet.</EmptyState>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1 font-medium">Date</th>
                  <th className="py-1 font-medium">Receipt</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                  <th className="py-1 text-right font-medium">Principal</th>
                  <th className="py-1 text-right font-medium">Interest</th>
                  <th className="py-1 text-right font-medium">Penalty</th>
                </tr>
              </thead>
              <tbody>
                {repayments.map((r) => (
                  <tr key={r.id} className={`border-t border-zinc-100 ${r.reversed_at ? "text-zinc-400 line-through" : ""}`}>
                    <td className="py-1.5">{formatDate(r.paid_on)}</td>
                    <td className="py-1.5 font-mono text-xs">
                      {r.txn_no}
                      {r.reversed_at && <span className="ml-2 font-sans no-underline">reversed</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(r.amount)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(r.principal)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(r.interest)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(r.penalty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {(loan.status === "active" || restructures.length > 0) && (
        <Card title="Restructuring">
          {restructures.length === 0 ? (
            <EmptyState>This loan has not been restructured. Only the Head of Credit can restructure a loan, and the Head of Business must approve it.</EmptyState>
          ) : (
            <ul className="mb-4 divide-y divide-zinc-100 text-sm">
              {restructures.map((r) => (
                <li key={r.id} className="space-y-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "amber"}>
                      {r.status === "pending" ? "Waiting for approval" : r.status === "approved" ? "Approved" : "Declined"}
                    </Badge>
                    <span>
                      {r.tenor_months} months, {REPAYMENT_FREQUENCIES[r.repayment_frequency].toLowerCase()}, at {Number(r.interest_rate)}
                      {RATE_BASES[r.rate_basis]} {INTEREST_METHODS[r.interest_method].toLowerCase()}, from {formatDate(r.first_repayment_date)}
                    </span>
                  </div>
                  <p className="text-zinc-600">{r.reason}</p>
                  <p className="text-xs text-zinc-500">
                    Requested by {staffName(r.requested_by)} on {formatDateTime(r.requested_at)}
                    {r.decided_at && `; decided by ${staffName(r.decided_by)} on ${formatDateTime(r.decided_at)}`}
                    {r.outstanding_principal && `; rescheduled ${formatMoney(r.outstanding_principal)} principal`}
                    {Number(r.carried_interest) > 0 && ` plus ${formatMoney(r.carried_interest)} unpaid interest`}
                    {Number(r.carried_penalty) > 0 && ` and ${formatMoney(r.carried_penalty)} unpaid late penalty`}
                    {r.decision_note && `. ${r.decision_note}`}
                  </p>
                  {r.status === "pending" && can("credit.business_approve") && r.requested_by !== staff.id && (
                    <RestructureDecisionForm action={decideRestructure.bind(null, loan.id, r.id)} />
                  )}
                  {r.status === "pending" && !(can("credit.business_approve") && r.requested_by !== staff.id) && (
                    <p className="text-xs text-zinc-600">Waiting for the Head of Business to approve or decline it.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {loan.status === "active" && can("credit.approve") && !pendingRestructure && (
            <RestructureForm
              action={requestRestructure.bind(null, loan.id)}
              defaults={{ rate: loan.interest_rate, basis: loan.rate_basis, method: loan.interest_method, frequency: loan.repayment_frequency }}
            />
          )}
        </Card>
      )}

      {loan.status === "active" && (
        <Card title="Reminders">
          {nextDue && canManage && (
            <div className="mb-4">
              <ReminderForm
                action={recordReminder.bind(null, loan.id)}
                kind={nextDue.status === "overdue" ? "overdue" : "upcoming"}
                dueDate={nextDue.due_date}
                amount={overdue ? position!.overdue_amount : nextDue.outstanding}
                message={
                  overdue
                    ? `Dear ${member.first_name}, your Silverkuun loan ${loan.loan_no} has ${formatMoney(position!.overdue_amount)} overdue. Please pay today to avoid further charges. Thank you.`
                    : `Dear ${member.first_name}, a reminder that ${formatMoney(nextDue.outstanding)} on your Silverkuun loan ${loan.loan_no} is due on ${formatDate(nextDue.due_date)}. Thank you.`
                }
              />
            </div>
          )}
          {reminders.length === 0 ? (
            <EmptyState>No reminders recorded.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {reminders.map((r) => (
                <li key={r.id} className="py-2">
                  <span className="font-medium">{r.kind === "overdue" ? "Overdue" : "Upcoming"}</span> by {REMINDER_CHANNELS[r.channel]}
                  {r.amount && ` for ${formatMoney(r.amount)}`}
                  {r.due_date && ` due ${formatDate(r.due_date)}`}
                  {r.note && <span className="text-zinc-600"> · {r.note}</span>}
                  <span className="block text-xs text-zinc-500">
                    {staffName(r.sent_by)}, {formatDateTime(r.sent_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {otherLoans.length > 0 && (
        <Card title={`Other loans for ${memberName}`}>
          <ul className="divide-y divide-zinc-100 text-sm">
            {otherLoans.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2">
                <Link href={`/credit/loans/${o.id}`} className="font-mono text-xs underline">
                  {o.loan_no}
                </Link>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMoney(o.approved_amount ?? o.amount_requested)}</span>
                  <Badge tone={LOAN_STATUSES[o.status].tone}>{LOAN_STATUSES[o.status].label}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
