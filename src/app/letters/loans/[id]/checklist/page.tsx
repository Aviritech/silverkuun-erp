import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Letter } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { today } from "@/lib/reports/filters";
import { ComplianceChecklist } from "@/modules/credit/components/kuun-form-print";
import { getFormLetter } from "@/modules/credit/form-letters";
import { creditModule } from "@/modules/credit/module";

export const metadata: Metadata = { title: "Compliance checklist · Silverkuun ERP" };

/** The compliance checklist for a loan on one of Kuun's forms, with the analyst's answers and who approved it. */
export default async function ComplianceChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(creditModule);
  const { id } = await params;
  const letter = await getFormLetter(id);
  if (!letter) notFound();

  return (
    <Letter
      title={`${letter.definition.name} checklist · ${letter.loan.loan_no} · ${letter.application.name}`}
      date={today()}
      backHref={`/credit/loans/${letter.loan.id}`}
      backLabel={`Back to loan ${letter.loan.loan_no}`}
      notes={
        letter.checklist.reviewerName
          ? "The answers are the ones the credit analyst recorded on the loan."
          : "The credit analyst hasn't done the checklist on the loan yet, so the lines are empty."
      }
    >
      <ComplianceChecklist form={letter.form} c={letter.checklist} />
    </Letter>
  );
}
