import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { saveLoan } from "@/modules/credit/actions";
import { LoanForm, type MemberChoice } from "@/modules/credit/components/loan-form";
import { creditModule } from "@/modules/credit/module";
import { listOfficers, listProducts, officersFor } from "@/modules/credit/queries";

export default async function NewLoanPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  const staff = await requireModule(creditModule);
  if (!staff.permissions.has("credit.manage")) notFound();
  const { member } = await searchParams;
  const supabase = await createClient();
  const [org, products, officers, members] = await Promise.all([
    listOrg(),
    listProducts(),
    listOfficers(),
    supabase
      .from("members")
      .select("id, first_name, middle_name, last_name, membership_no, branch_id, phone, address")
      .eq("status", "approved")
      .order("last_name")
      .limit(2000),
  ]);
  if (members.error) throw dbFailure(members.error);
  const branches = org.branches.filter((b) => staff.permissions.hasForBranch("credit.manage", b));
  const choices: MemberChoice[] = members.data
    .filter((m) => branches.some((b) => b.id === m.branch_id))
    .map((m) => ({
      id: m.id,
      name: [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" "),
      membership_no: m.membership_no,
      branch_id: m.branch_id,
      phone: m.phone,
      address: m.address,
    }));
  const preselected = choices.find((m) => m.id === member);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New loan application"
        description="Capture the customer's request, employment and terms. Guarantors, collateral and documents are added on the next page, then the application goes to a credit analyst for appraisal."
      />
      <Card>
        <LoanForm
          action={saveLoan.bind(null, null)}
          products={products}
          members={preselected ? [preselected] : choices}
          officersByBranch={Object.fromEntries(branches.map((b) => [b.id, officersFor(officers, b)]))}
          branchName={Object.fromEntries(org.branches.map((b) => [b.id, b.name]))}
          defaultOfficerId={staff.id}
          submitLabel="Save draft"
        />
      </Card>
      {choices.length === 0 && (
        <p className="mt-4 text-sm text-zinc-600">
          There are no approved members in your branches yet. Loans are raised for members whose files Administration has had approved.
        </p>
      )}
    </div>
  );
}
