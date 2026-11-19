import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Letter } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { today } from "@/lib/reports/filters";
import { ApplicationForm, SaleOfAssets } from "@/modules/credit/components/kuun-form-print";
import { getFormLetter } from "@/modules/credit/form-letters";
import { creditModule } from "@/modules/credit/module";

export const metadata: Metadata = { title: "Loan application form · Silverkuun ERP" };

/** The customer's application on Kuun's form for the loan's product, filled in from the loan. */
export default async function LoanApplicationFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(creditModule);
  const { id } = await params;
  const letter = await getFormLetter(id);
  if (!letter) notFound();
  const { loan, form, definition, application, gaps } = letter;

  return (
    <Letter
      title={`${definition.name} application · ${loan.loan_no} · ${application.name}`}
      date={today()}
      backHref={`/credit/loans/${loan.id}`}
      backLabel={`Back to loan ${loan.loan_no}`}
      gaps={gaps}
      notes={
        <>
          Filled in from the application; anything not on file prints as dotted lines to complete by hand. Have the customer sign it,
          then upload it on the loan as the &quot;Signed application form&quot;.
          {form === "property_backed" && " The sale of assets agreement follows on the next page, listing the collateral on the loan."}
        </>
      }
    >
      <ApplicationForm form={form} d={application} />
      {form === "property_backed" && <SaleOfAssets d={application} />}
    </Letter>
  );
}
