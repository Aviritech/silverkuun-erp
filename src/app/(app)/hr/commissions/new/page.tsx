import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { createTarget } from "@/modules/hr/commissions/actions";
import { TargetForm } from "@/modules/hr/commissions/forms";
import { requireCommissionAccess, targetCandidates } from "@/modules/hr/commissions/queries";

export default async function NewTargetPage() {
  await requireCommissionAccess();
  const staff = await requirePermission("commission.manage");
  const [candidates, { branches }] = await Promise.all([targetCandidates(), listOrg()]);
  const branchById = new Map(branches.map((b) => [b.id, b]));
  // Only branches where this person may set targets, and never their own record.
  const employees = candidates
    .filter((e) => {
      const branch = branchById.get(e.branch_id);
      return branch && e.staff_id !== staff.id && staff.permissions.hasForBranch("commission.manage", branch);
    })
    .map((e) => ({ ...e, branch_name: branchById.get(e.branch_id)?.name ?? "" }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Set a commission target"
        description="The employee records their sales against it. Approved sales count, and the commission is worked out and paid with the first payroll after the period ends."
      />
      <Card>
        <TargetForm action={createTarget} employees={employees} />
      </Card>
    </div>
  );
}
