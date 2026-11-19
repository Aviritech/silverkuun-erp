import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Letter } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { today } from "@/lib/reports/filters";
import { GuarantorForm } from "@/modules/credit/components/kuun-form-print";
import { getFormLetter } from "@/modules/credit/form-letters";
import { creditModule } from "@/modules/credit/module";

export const metadata: Metadata = { title: "Guarantor form · Silverkuun ERP" };

/** One guarantor's form for a loan on one of Kuun's forms, filled in from what the officer recorded. */
export default async function GuarantorFormPage({ params }: { params: Promise<{ id: string; guarantorId: string }> }) {
  await requireModule(creditModule);
  const { id, guarantorId } = await params;
  const letter = await getFormLetter(id);
  const g = letter?.guarantor(guarantorId);
  if (!letter || !g) notFound();

  return (
    <Letter
      title={`${letter.definition.name} guarantor form · ${letter.loan.loan_no} · ${g.fullName}`}
      date={today()}
      backHref={`/credit/loans/${letter.loan.id}`}
      backLabel={`Back to loan ${letter.loan.loan_no}`}
      notes="Have the guarantor sign it, then upload it on the loan as the “Guarantor's form” (or sign the guarantee electronically on the loan)."
    >
      <GuarantorForm form={letter.form} g={g} />
    </Letter>
  );
}
