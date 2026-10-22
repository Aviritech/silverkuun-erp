import { EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { postContribution } from "@/modules/accounts/actions";
import { ContributionPostForm } from "@/modules/accounts/components/contribution-post-form";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts } from "@/modules/accounts/queries";
import { CONTRIBUTION_KINDS, PAYMENT_METHODS } from "@/modules/administration/constants";

export default async function ContributionsAwaitingPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.receipts.record");
  const supabase = await createClient();
  const [{ data, error }, banks, org] = await Promise.all([
    supabase.from("contributions_awaiting_posting").select("*").order("paid_on"),
    listBankAccounts(),
    listOrg(),
  ]);
  if (error) throw dbFailure(error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  type C = {
    id: string;
    member_name: string;
    membership_no: string | null;
    branch_id: string;
    kind: keyof typeof CONTRIBUTION_KINDS;
    amount: string;
    paid_on: string;
    payment_method: keyof typeof PAYMENT_METHODS;
    reference: string | null;
  };
  const list = (data as C[]).filter((c) => {
    const branch = org.branches.find((b) => b.id === c.branch_id);
    return branch && staff.permissions.hasForBranch("accounts.receipts.record", branch);
  });

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Contributions from Operations"
        description="Payments Operations has recorded and the Branch Manager has verified. Say which account the money went into; someone else then confirms it and it posts to the member's savings."
      />
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {list.length === 0 ? (
          <EmptyState>Nothing is waiting. Verified contributions appear here automatically.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Member</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Paid</th>
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Post to</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const choices = banks.filter((b) => b.is_active && b.branch_id === c.branch_id);
                const preferred = choices.find((b) => (c.payment_method === "cash" ? b.kind === "cash" : b.kind === "bank"));
                return (
                  <tr key={c.id} className="border-b border-zinc-100 align-top last:border-0">
                    <td className="px-4 py-2">
                      {c.member_name}
                      <span className="block text-xs text-zinc-500">{c.membership_no}</span>
                    </td>
                    <td className="px-4 py-2">{branchName.get(c.branch_id)}</td>
                    <td className="px-4 py-2">{CONTRIBUTION_KINDS[c.kind]}</td>
                    <td className="px-4 py-2">
                      {formatDate(c.paid_on)}
                      <span className="block text-xs text-zinc-500">{PAYMENT_METHODS[c.payment_method]}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{c.reference ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.amount)}</td>
                    <td className="px-4 py-2">
                      <ContributionPostForm action={postContribution.bind(null, c.id)} banks={choices} defaultBankId={preferred?.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
