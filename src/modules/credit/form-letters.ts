import "server-only";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { branchManagerName } from "@/modules/administration/letters";
import type { ApplicationPrint, ChecklistPrint, GuarantorPrint } from "./components/kuun-form-print";
import { FORMS, ID_TYPES, isKuunForm, type KuunForm } from "./loan-forms";
import { getLoanBundle } from "./queries";

type MemberExtras = {
  gender: string | null;
  date_of_birth: string | null;
  email: string | null;
  nin: string | null;
  id_type: string | null;
  id_number: string | null;
};

/** A loan on one of Kuun's forms, with everything its printed forms show. Null when the loan isn't on a Kuun form. */
export async function getFormLetter(loanId: string) {
  const bundle = await getLoanBundle(loanId);
  if (!bundle || !isKuunForm(bundle.product.application_form)) return null;
  const { loan, member, memberName, product, collaterals, staffName, review, checklist, guarantors } = bundle;
  const form: KuunForm = product.application_form as KuunForm;
  const [org, manager, extras] = await Promise.all([listOrg(), branchManagerName(loan.branch_id), memberExtras(loan.member_id)]);
  const name = memberName.toUpperCase();
  const officer = staffName(loan.account_officer_id);

  const application: ApplicationPrint = {
    name,
    membershipNo: member.membership_no,
    gender: extras.gender,
    dateOfBirth: extras.date_of_birth,
    email: extras.email,
    phone: loan.phone,
    address: loan.address,
    landmark: loan.address_landmark,
    nin: extras.nin,
    idType: extras.id_type ? (ID_TYPES[extras.id_type as keyof typeof ID_TYPES] ?? extras.id_type) : null,
    idNumber: extras.id_number,
    employerName: loan.employer_name,
    occupation: loan.occupation,
    employerAddress: loan.employer_address,
    monthlyIncome: loan.monthly_income,
    amountRequested: loan.amount_requested,
    tenorMonths: loan.tenor_months,
    frequency: loan.repayment_frequency,
    purpose: loan.purpose,
    interestRate: loan.interest_rate,
    repaymentMode: loan.repayment_mode,
    details: loan.form_details,
    collaterals: collaterals.map((c) => ({ description: c.description, value: c.estimated_value })),
    applicationDate: (loan.submitted_at ?? loan.created_at).slice(0, 10),
    officerName: officer,
    branchName: org.branches.find((b) => b.id === loan.branch_id)?.name ?? "",
    managerName: manager,
    bureauCheck: loan.bureau_check,
    recommendation: loan.recommendation,
    approvedAmount: loan.approved_amount,
    approverName: loan.approved_by ? staffName(loan.approved_by) : null,
    approvedAt: loan.approved_at,
    review: review ? { methods: review.verification_methods, kycStatus: review.kyc_status, kycRecommendation: review.kyc_recommendation } : null,
  };

  const guarantor = (id: string): GuarantorPrint | null => {
    const g = guarantors.find((x) => x.id === id);
    if (!g) return null;
    return {
      fullName: g.full_name.toUpperCase(),
      phone: g.phone,
      address: g.address,
      relationship: g.relationship,
      occupation: g.occupation,
      employer: g.employer,
      monthlyIncome: g.monthly_income,
      details: g.form_details,
      borrowerName: name,
      loanAmount: loan.approved_amount ?? loan.amount_requested,
      tenorMonths: loan.tenor_months,
      date: (loan.submitted_at ?? loan.created_at).slice(0, 10),
      officerName: officer,
      managerName: manager,
      confirmedBy: g.confirmed_by ? staffName(g.confirmed_by) : null,
      confirmationNote: g.confirmation_note,
    };
  };

  const checklistPrint: ChecklistPrint = {
    name,
    membershipNo: member.membership_no,
    answers: Object.fromEntries(checklist.map((c) => [c.item_code, { answer: c.answer, remark: c.remark }])),
    reviewerName: review ? staffName(review.reviewed_by) : null,
    reviewedAt: review?.reviewed_at ?? null,
    note: review?.note ?? null,
    approvedAmount: loan.approved_amount,
    approvalNote: loan.approval_note,
    officerName: officer,
    evaluatorName: loan.appraised_by ? staffName(loan.appraised_by) : null,
    evaluatedAt: loan.appraised_at,
    headOfCreditName: loan.approved_by ? staffName(loan.approved_by) : null,
    headOfCreditAt: loan.approved_at,
    headOfBusinessName: loan.business_approved_by ? staffName(loan.business_approved_by) : null,
    headOfBusinessAt: loan.business_approved_at,
    managerName: manager,
  };

  const gaps = [
    !member.membership_no && "The member's membership number",
    form !== "kuun_asset" && !loan.form_details.bvn && "The customer's BVN",
    !manager && "A Branch Manager for this branch",
  ].filter(Boolean) as string[];

  return { loan, form, definition: FORMS[form], application, guarantor, guarantors, checklist: checklistPrint, gaps };
}

async function memberExtras(memberId: string): Promise<MemberExtras> {
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("gender, date_of_birth, email, nin, id_type, id_number").eq("id", memberId).maybeSingle();
  return (data as MemberExtras | null) ?? { gender: null, date_of_birth: null, email: null, nin: null, id_type: null, id_number: null };
}
