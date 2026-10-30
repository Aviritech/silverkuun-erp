import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { internalAuditModule } from "@/modules/internal-audit/module";

type Row = {
  id: string;
  txn_no: string;
  txn_date: string;
  amount: string;
  counterparty: string | null;
  description: string;
  branch_id: string;
  approved_at: string;
  created_by: string;
  submitted_by: string | null;
  approved_by: string | null;
  members: { first_name: string; last_name: string } | null;
  posting_rules: { name: string };
};

/** Every outflow Accounts has approved, waiting for Internal Audit before it can be paid. */
export default async function PaymentsAwaitingAuditPage() {
  await requireModule(internalAuditModule);
  const staff = await requirePermission("audit.payments.approve");
  const supabase = await createClient();
  const [{ data, error }, org] = await Promise.all([
    supabase
      .from("finance_transactions")
      .select(
        "id, txn_no, txn_date, amount, counterparty, description, branch_id, approved_at, created_by, submitted_by, approved_by, members(first_name, last_name), posting_rules(name)",
      )
      .eq("direction", "payment")
      .eq("status", "approved")
      .is("audited_at", null)
      .order("approved_at"),
    listOrg(),
  ]);
  if (error) throw dbFailure(error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  const rows = data as unknown as Row[];
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Payments to approve"
        description={`Every outflow (expenses, supplier payments, loan disbursements, salaries) needs Internal Audit's approval after Accounts approves it and before it is paid. ${rows.length} waiting, ${formatMoney(total)} in all.`}
      />
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {rows.length === 0 ? (
          <EmptyState>Nothing is waiting for Internal Audit.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">No.</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">For</th>
                <th className="px-4 py-2 font-medium">Beneficiary</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Approved by Accounts</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const workedOnIt = [t.created_by, t.submitted_by, t.approved_by].includes(staff.id);
                return (
                  <tr key={t.id} className="border-b border-zinc-100 last:border-0 align-top">
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link href={`/accounts/transactions/${t.id}`} className="hover:underline">
                        {t.txn_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{formatDate(t.txn_date)}</td>
                    <td className="px-4 py-2">
                      {t.posting_rules.name}
                      <div className="text-xs text-zinc-500">{t.description}</div>
                    </td>
                    <td className="px-4 py-2">{t.members ? `${t.members.first_name} ${t.members.last_name}` : (t.counterparty ?? "—")}</td>
                    <td className="px-4 py-2">{branchName.get(t.branch_id)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.amount)}</td>
                    <td className="px-4 py-2 text-xs text-zinc-600">{formatDateTime(t.approved_at)}</td>
                    <td className="px-4 py-2 text-right">
                      {workedOnIt ? (
                        <span className="text-xs text-zinc-500">Another auditor</span>
                      ) : (
                        <Link href={`/accounts/transactions/${t.id}`} className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-white">
                          Review
                        </Link>
                      )}
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
