import Link from "next/link";
import { Badge, ButtonLink, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { DIRECTIONS, FINANCE_STATUSES, type FinanceStatus } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";

const PAGE_SIZE = 100;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ status?: string; direction?: string }> }) {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const { status, direction } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("finance_transactions")
    .select("id, txn_no, txn_date, direction, status, amount, counterparty, description, branch_id, members(first_name, last_name), posting_rules(name)")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (status === "waiting") query = query.in("status", ["submitted", "approved"]);
  else if (status && status in FINANCE_STATUSES) query = query.eq("status", status);
  if (direction && direction in DIRECTIONS) query = query.eq("direction", direction);
  const [{ data, error }, org] = await Promise.all([query, listOrg()]);
  if (error) throw dbFailure(error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  type Row = {
    id: string; txn_no: string; txn_date: string; direction: "receipt" | "payment"; status: FinanceStatus; amount: string;
    counterparty: string | null; description: string; branch_id: string;
    members: { first_name: string; last_name: string } | null; posting_rules: { name: string };
  };
  const list = data as unknown as Row[];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Receipts and payments"
        description="Every receipt and payment request, from capture through approval to posting."
        actions={
          <>
            {staff.permissions.has("accounts.receipts.record") && <ButtonLink href="/accounts/transactions/new?direction=receipt">Record receipt</ButtonLink>}
            {staff.permissions.has("accounts.payments.request") && (
              <ButtonLink href="/accounts/transactions/new?direction=payment" variant="secondary">
                Request payment
              </ButtonLink>
            )}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <div className="w-56">
          <Select name="status" defaultValue={status ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            <option value="waiting">Waiting for approval or payment</option>
            {(Object.keys(FINANCE_STATUSES) as FinanceStatus[]).map((s) => (
              <option key={s} value={s}>
                {FINANCE_STATUSES[s].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select name="direction" defaultValue={direction ?? ""} aria-label="Type">
            <option value="">Receipts and payments</option>
            <option value="receipt">Receipts</option>
            <option value="payment">Payments</option>
          </Select>
        </div>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {list.length === 0 ? (
          <EmptyState>No transactions match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">No.</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">For</th>
                <th className="px-4 py-2 font-medium">Member / beneficiary</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/accounts/transactions/${t.id}`} className="hover:underline">
                      {t.txn_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{formatDate(t.txn_date)}</td>
                  <td className="px-4 py-2">{t.posting_rules.name}</td>
                  <td className="px-4 py-2">{t.members ? `${t.members.first_name} ${t.members.last_name}` : (t.counterparty ?? "—")}</td>
                  <td className="px-4 py-2">{branchName.get(t.branch_id)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${t.direction === "payment" ? "text-red-800" : ""}`}>
                    {t.direction === "payment" ? "−" : ""}
                    {formatMoney(t.amount)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={FINANCE_STATUSES[t.status].tone}>{FINANCE_STATUSES[t.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.length === PAGE_SIZE && (
        <p className="mt-2 text-xs text-zinc-500">
          Showing the latest {PAGE_SIZE}. The <Link href="/accounts/reports/transactions" className="underline">register report</Link> covers any period.
        </p>
      )}
    </div>
  );
}
