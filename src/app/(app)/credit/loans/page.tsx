import Link from "next/link";
import { Badge, ButtonLink, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { LOAN_STATUSES, type LoanStatus } from "@/modules/credit/constants";
import { creditModule } from "@/modules/credit/module";
import { officerNames, type LoanBookRow } from "@/modules/credit/queries";

const PAGE_SIZE = 100;

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; overdue?: string }> }) {
  const staff = await requireModule(creditModule);
  await requirePermission("credit.read");
  const { status, q, overdue } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("loan_book").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE);
  if (status && status in LOAN_STATUSES) query = query.eq("status", status);
  if (overdue === "1") query = query.gt("days_past_due", 0);
  const search = q?.trim().replace(/[%,()]/g, "");
  if (search) query = query.or(`loan_no.ilike.%${search}%,member_name.ilike.%${search}%,membership_no.ilike.%${search}%`);
  const [{ data, error }, org, officers] = await Promise.all([query, listOrg(), officerNames()]);
  if (error) throw dbFailure(error);
  const loans = data as LoanBookRow[];
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Loans"
        description="Every application and loan in the branches you cover, from draft to fully repaid."
        actions={staff.permissions.has("credit.manage") && <ButtonLink href="/credit/loans/new">New application</ButtonLink>}
      />
      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <div className="min-w-56 flex-1">
          <Input name="q" defaultValue={q} placeholder="Search loan no., customer or membership no." aria-label="Search" />
        </div>
        <div className="w-52">
          <Select name="status" defaultValue={status ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            {(Object.keys(LOAN_STATUSES) as LoanStatus[]).map((s) => (
              <option key={s} value={s}>
                {LOAN_STATUSES[s].label}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={overdue === "1"} className="h-4 w-4 rounded border-zinc-300" /> Overdue only
        </label>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {loans.length === 0 ? (
          <EmptyState>No loans match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-silver-50/60 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Loan</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Officer</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                <th className="px-4 py-2 text-right font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id} className="border-b border-zinc-100 last:border-0 hover:bg-silver-50/60">
                  <td className="px-4 py-2">
                    <Link href={`/credit/loans/${l.id}`} className="font-mono text-xs font-medium text-ink hover:underline">
                      {l.loan_no}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      {branchName.get(l.branch_id)} · {formatDate(l.created_at)}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {l.member_name}
                    <div className="font-mono text-xs text-zinc-500">{l.membership_no}</div>
                  </td>
                  <td className="px-4 py-2">{l.product_name}</td>
                  <td className="px-4 py-2">{officers.get(l.account_officer_id) ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Badge tone={LOAN_STATUSES[l.status].tone}>{LOAN_STATUSES[l.status].label}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(l.approved_amount ?? l.amount_requested)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {["active", "closed"].includes(l.status) ? formatMoney(Number(l.outstanding_principal) + Number(l.outstanding_interest)) : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {Number(l.overdue_amount) > 0 && (
                      <span className="font-medium text-red-700">
                        {formatMoney(l.overdue_amount)}
                        <span className="block text-xs font-normal">{l.days_past_due} days</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {loans.length === PAGE_SIZE && <p className="mt-2 text-xs text-zinc-500">Showing the latest {PAGE_SIZE}. Search or filter to narrow down.</p>}
    </div>
  );
}
