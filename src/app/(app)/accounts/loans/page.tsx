import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { FINANCE_STATUSES, type FinanceStatus } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";

type Approved = {
  id: string;
  loan_no: string;
  branch_id: string;
  member_name: string;
  product_name: string;
  approved_amount: string;
  approved_at: string;
  disbursement_txn_id: string | null;
  disbursement_txn_no: string | null;
  disbursement_status: FinanceStatus | null;
};

export default async function LoansToDisbursePage() {
  const staff = await requireModule(accountsModule);
  await requirePermission("accounts.read");
  const supabase = await createClient();
  const [{ data, error }, org] = await Promise.all([
    supabase
      .from("loans")
      .select("id, loan_no, branch_id, approved_amount, approved_at, disbursement_txn_id, disbursement_txn_no, disbursement_status, members(first_name, middle_name, last_name), loan_products(name)")
      .eq("status", "approved")
      .order("approved_at"),
    listOrg(),
  ]);
  if (error) throw dbFailure(error);
  type Raw = Omit<Approved, "member_name" | "product_name"> & {
    members: { first_name: string; middle_name: string | null; last_name: string };
    loan_products: { name: string };
  };
  const loans: Approved[] = (data as unknown as Raw[]).map((l) => ({
    ...l,
    member_name: [l.members.first_name, l.members.middle_name, l.members.last_name].filter(Boolean).join(" "),
    product_name: l.loan_products.name,
  }));
  const branches = new Map(org.branches.map((b) => [b.id, b]));
  const waiting = loans.filter((l) => !l.disbursement_status || ["rejected", "reversed"].includes(l.disbursement_status));
  const inProgress = loans.filter((l) => !waiting.includes(l));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Loans to pay out"
        description="Loans approved by Credit and waiting for the money to go out. The payment goes through the usual approval and proof of payment; when it posts, the loan becomes active and its schedule starts."
      />
      <Card title={`Waiting for a payment request (${waiting.length})`}>
        {waiting.length === 0 ? (
          <EmptyState>No approved loans are waiting.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Loan</th>
                <th className="py-1 font-medium">Customer</th>
                <th className="py-1 font-medium">Product</th>
                <th className="py-1 font-medium">Approved</th>
                <th className="py-1 text-right font-medium">Amount</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {waiting.map((l) => (
                <tr key={l.id} className="border-t border-zinc-100">
                  <td className="py-2">
                    <span className="font-mono text-xs">{l.loan_no}</span>
                    <div className="text-xs text-zinc-500">{branches.get(l.branch_id)?.name}</div>
                  </td>
                  <td className="py-2">{l.member_name}</td>
                  <td className="py-2">{l.product_name}</td>
                  <td className="py-2">
                    {formatDate(l.approved_at)}
                    {l.disbursement_status && <span className="block text-xs text-red-700">Earlier payment {l.disbursement_txn_no} {l.disbursement_status}</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(l.approved_amount)}</td>
                  <td className="py-2 text-right">
                    {staff.permissions.hasForBranch("accounts.payments.request", branches.get(l.branch_id)!) && (
                      <ButtonLink href={`/accounts/transactions/new?direction=payment&loan=${l.id}`}>Request payment</ButtonLink>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title={`Being paid out (${inProgress.length})`}>
        {inProgress.length === 0 ? (
          <EmptyState>Nothing in progress.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {inProgress.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <span className="font-mono text-xs">{l.loan_no}</span> · {l.member_name} · {formatMoney(l.approved_amount)}
                </span>
                <span className="flex items-center gap-3">
                  {l.disbursement_status && <Badge tone={FINANCE_STATUSES[l.disbursement_status].tone}>{FINANCE_STATUSES[l.disbursement_status].label}</Badge>}
                  {l.disbursement_txn_id && (
                    <Link href={`/accounts/transactions/${l.disbursement_txn_id}`} className="font-mono text-xs underline">
                      {l.disbursement_txn_no}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-sm text-zinc-500">
        Loan repayments are recorded as receipts against the loan.{" "}
        {staff.permissions.has("accounts.receipts.record") && (
          <Link href="/accounts/transactions/new?direction=receipt" className="underline">
            Record a repayment
          </Link>
        )}
      </p>
    </div>
  );
}
