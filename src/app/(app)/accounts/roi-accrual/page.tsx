import { notFound } from "next/navigation";
import { Card, PageHeader, Select } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createRoiAccrual } from "@/modules/accounts/actions";
import { RoiAccrualForm, type AccrualMember } from "@/modules/accounts/components/roi-accrual-form";
import { accountsModule } from "@/modules/accounts/module";

export default async function RoiAccrualPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const staff = await requireModule(accountsModule);
  const org = await listOrg();
  const branches = org.branches.filter((b) => staff.permissions.hasForBranch("accounts.journals.prepare", b));
  if (branches.length === 0) notFound();
  const { branch: requested } = await searchParams;
  const branch = branches.find((b) => b.id === requested) ?? (branches.length === 1 ? branches[0] : undefined);

  let members: AccrualMember[] = [];
  if (branch) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("plan_progress")
      .select("member_id, member_name, membership_no, total_verified")
      .eq("branch_id", branch.id)
      .in("status", ["active", "matured"])
      .order("member_name");
    if (error) throw dbFailure(error);
    const byMember = new Map<string, AccrualMember>();
    for (const p of data) {
      const m = byMember.get(p.member_id) ?? { member_id: p.member_id, name: p.member_name, membership_no: p.membership_no, balance: 0 };
      m.balance += Number(p.total_verified);
      byMember.set(p.member_id, m);
    }
    members = [...byMember.values()];
  }

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="ROI accrual"
        description="Accrue members' returns as an expense: one debit to 5100 Interest expense and a credit to 2140 ROI payable per member. It saves as a draft journal for the Financial Controller to post."
      />
      <form className="flex items-end gap-3" role="search">
        <label className="w-56 text-sm">
          Branch
          <Select name="branch" defaultValue={branch?.id ?? ""}>
            <option value="">Choose</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Show members
        </button>
      </form>
      {branch && (
        <Card title={`Members with active plans in ${branch.name}`}>
          {members.length === 0 ? (
            <p className="text-sm text-zinc-600">No members in this branch have active plans.</p>
          ) : (
            <RoiAccrualForm action={createRoiAccrual} branchId={branch.id} members={members} />
          )}
        </Card>
      )}
      <p className="text-xs text-zinc-500">
        The ROI rate per product, and whether it is accrued monthly, is still to be confirmed with Kuun. Until then, enter the amounts the
        Society&apos;s accountant has worked out.
      </p>
    </div>
  );
}
