import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { saveLoan } from "@/modules/credit/actions";
import { LoanForm } from "@/modules/credit/components/loan-form";
import { creditModule } from "@/modules/credit/module";
import { getLoanBundle, listOfficers, listProducts, officersFor } from "@/modules/credit/queries";

export default async function EditLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(creditModule);
  const { id } = await params;
  const [bundle, org, products, officers] = await Promise.all([getLoanBundle(id), listOrg(), listProducts(), listOfficers()]);
  if (!bundle) notFound();
  const branch = org.branches.find((b) => b.id === bundle.loan.branch_id)!;
  if (!["draft", "returned"].includes(bundle.loan.status) || !staff.permissions.hasForBranch("credit.manage", branch)) notFound();

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${bundle.loan.loan_no}`} description={`${bundle.memberName} · ${branch.name}`} />
      <Card>
        <LoanForm
          action={saveLoan.bind(null, id)}
          products={products}
          loan={bundle.loan}
          officersByBranch={{ [branch.id]: officersFor(officers, branch) }}
          branchName={{ [branch.id]: branch.name }}
          submitLabel="Save changes"
        />
      </Card>
    </div>
  );
}
