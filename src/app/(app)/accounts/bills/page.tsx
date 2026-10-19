import Link from "next/link";
import { Badge, ButtonLink, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { BILL_STATUSES, type BillStatus } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";
import { listSuppliers } from "@/modules/accounts/queries";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ status?: string; supplier?: string }> }) {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const { status, supplier } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("supplier_bill_balances")
    .select("id, bill_no, supplier_name, branch_id, bill_date, due_date, supplier_reference, amount, status, paid, outstanding")
    .order("bill_date", { ascending: false })
    .limit(200);
  if (status === "unpaid") query = query.eq("status", "posted").gt("outstanding", 0);
  else if (status && status in BILL_STATUSES) query = query.eq("status", status);
  if (supplier && UUID.test(supplier)) query = query.eq("supplier_id", supplier);
  const [{ data, error }, org, suppliers] = await Promise.all([query, listOrg(), listSuppliers()]);
  if (error) throw dbFailure(error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  type Row = {
    id: string; bill_no: string; supplier_name: string; branch_id: string; bill_date: string; due_date: string;
    supplier_reference: string; amount: string; status: BillStatus; paid: string; outstanding: string;
  };
  const list = data as Row[];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Supplier bills"
        description="Invoices from suppliers. Approving a bill posts it to supplier payables; paying it is a supplier payment against the bill."
        actions={
          <>
            {staff.permissions.has("accounts.payments.request") && <ButtonLink href="/accounts/bills/new">Record bill</ButtonLink>}
            <ButtonLink href="/accounts/suppliers" variant="secondary">
              Suppliers
            </ButtonLink>
          </>
        }
      />
      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <div className="w-56">
          <Select name="status" defaultValue={status ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            <option value="unpaid">Approved, not fully paid</option>
            {(Object.keys(BILL_STATUSES) as BillStatus[]).map((s) => (
              <option key={s} value={s}>
                {BILL_STATUSES[s].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <Select name="supplier" defaultValue={supplier ?? ""} aria-label="Supplier">
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {list.length === 0 ? (
          <EmptyState>No bills match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">No.</th>
                <th className="px-4 py-2 font-medium">Supplier</th>
                <th className="px-4 py-2 font-medium">Invoice</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">Owed</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => {
                const overdue = b.status === "posted" && Number(b.outstanding) > 0 && b.due_date < today;
                return (
                  <tr key={b.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link href={`/accounts/bills/${b.id}`} className="hover:underline">
                        {b.bill_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{b.supplier_name}</td>
                    <td className="px-4 py-2">
                      {b.supplier_reference} <span className="text-xs text-zinc-500">{formatDate(b.bill_date)}</span>
                    </td>
                    <td className="px-4 py-2">{branchName.get(b.branch_id)}</td>
                    <td className={`px-4 py-2 ${overdue ? "font-medium text-red-700" : ""}`}>{formatDate(b.due_date)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(b.amount)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.status === "posted" ? formatMoney(b.outstanding) : "—"}</td>
                    <td className="px-4 py-2">
                      <Badge tone={BILL_STATUSES[b.status].tone}>{BILL_STATUSES[b.status].label}</Badge>
                      {b.status === "posted" && Number(b.outstanding) === 0 && (
                        <span className="ml-1">
                          <Badge tone="green">Paid</Badge>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        See <Link href="/accounts/reports/payables-aging" className="underline">payables aging</Link> for what is owed by how overdue it is.
      </p>
    </div>
  );
}
