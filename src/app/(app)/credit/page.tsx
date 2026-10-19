import Link from "next/link";
import { ButtonLink, Card, Input, PageHeader, Select } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { startOfYear, today } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { inPeriod, isDisbursed, isPending, loadBook, loadOfficerNames, n, pct, portfolio, round2, wasApproved } from "@/modules/credit/book";
import { CUSTOMER_CATEGORIES, LOAN_STATUSES, type LoanStatus } from "@/modules/credit/constants";
import { creditModule } from "@/modules/credit/module";
import { listProducts, type LoanBookRow } from "@/modules/credit/queries";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

type Search = { from?: string; to?: string; branch?: string; officer?: string; product?: string; category?: string };

function Stat({ label, value, sub, href, tone }: { label: string; value: string; sub?: string; href?: string; tone?: "red" }) {
  const body = (
    <>
      <p className="text-sm text-zinc-600">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "red" ? "text-red-700" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">{body}</div>
  );
}

function Breakdown({ title, rows, href }: { title: string; rows: { name: string; disbursed: number; principal: number; overdue: number; par30: string }[]; href: string }) {
  return (
    <Card title={title} actions={<Link href={href} className="text-sm underline">Full report</Link>}>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-600">No loans yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium" />
                <th className="py-1 pr-3 text-right font-medium">Disbursed in period</th>
                <th className="py-1 pr-3 text-right font-medium">Portfolio</th>
                <th className="py-1 pr-3 text-right font-medium">Overdue</th>
                <th className="py-1 text-right font-medium">PAR 30</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-zinc-100">
                  <td className="py-1.5 pr-3">{r.name}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(r.disbursed)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(r.principal)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${r.overdue > 0 ? "text-red-700" : ""}`}>{formatMoney(r.overdue)}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.par30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default async function CreditDashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireModule(creditModule);
  const q = await searchParams;
  const to = q.to && ISO.test(q.to) ? q.to : today();
  const from = q.from && ISO.test(q.from) && q.from <= to ? q.from : startOfYear(to);
  const branch = q.branch && UUID.test(q.branch) ? q.branch : null;
  const filters = { branch, region: null, officer: q.officer ?? "", product: q.product ?? "", category: q.category ?? "" };

  if (!staff.permissions.has("credit.read")) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Credit" description="You can open the Credit department but not its loan records. Ask the Head of Credit for access." />
      </div>
    );
  }

  const supabase = await createClient();
  const [loans, org, officers, products] = await Promise.all([loadBook(supabase, filters), listOrg(), loadOfficerNames(supabase), listProducts()]);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  const query = new URLSearchParams(Object.entries({ from, to, branch: branch ?? "", officer: filters.officer, loan_product: filters.product, category: filters.category }).filter(([, v]) => v)).toString();

  const received = loans.filter((l) => inPeriod(l.created_at, from, to));
  const approvedInPeriod = loans.filter((l) => l.approved_at && inPeriod(l.approved_at, from, to) && wasApproved(l));
  const disbursedInPeriod = loans.filter((l) => isDisbursed(l) && inPeriod(l.disbursed_on, from, to));
  const book = portfolio(loans);
  const count = (s: LoanStatus) => loans.filter((l) => l.status === s).length;
  const awaiting = loans.filter((l) => l.status === "approved");

  function breakdown(key: (l: LoanBookRow) => string) {
    const groups = new Map<string, LoanBookRow[]>();
    for (const l of loans) if (isDisbursed(l) || l.status === "approved") groups.set(key(l), [...(groups.get(key(l)) ?? []), l]);
    return [...groups]
      .map(([name, list]) => {
        const p = portfolio(list);
        return {
          name,
          disbursed: round2(list.filter((l) => isDisbursed(l) && inPeriod(l.disbursed_on, from, to)).reduce((s, l) => s + n(l.approved_amount), 0)),
          principal: p.principal,
          overdue: p.overdue,
          par30: pct(p.par30, p.principal),
        };
      })
      .sort((a, b) => b.principal - a.principal || a.name.localeCompare(b.name));
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Credit"
        description="Loan pipeline, disbursements, repayments and the portfolio at risk for the branches you cover."
        actions={staff.permissions.has("credit.manage") && <ButtonLink href="/credit/loans/new">New application</ButtonLink>}
      />

      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="text-sm">
          From
          <Input type="date" name="from" defaultValue={from} />
        </label>
        <label className="text-sm">
          To
          <Input type="date" name="to" defaultValue={to} />
        </label>
        <label className="w-40 text-sm">
          Branch
          <Select name="branch" defaultValue={branch ?? ""}>
            <option value="">All branches</option>
            {org.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-44 text-sm">
          Account officer
          <Select name="officer" defaultValue={filters.officer}>
            <option value="">All officers</option>
            {[...officers].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-44 text-sm">
          Loan product
          <Select name="product" defaultValue={filters.product}>
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-44 text-sm">
          Customer category
          <Select name="category" defaultValue={filters.category}>
            <option value="">All customers</option>
            {Object.entries(CUSTOMER_CATEGORIES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Apply
        </button>
      </form>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">Applications in the period</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Received" value={String(received.length)} sub={formatMoney(received.reduce((s, l) => s + n(l.amount_requested), 0))} href={`/credit/reports/loan-applications?${query}`} />
          <Stat
            label="Pending"
            value={String(received.filter(isPending).length)}
            sub={`${count("submitted")} awaiting appraisal, ${count("appraised")} awaiting decision (all dates)`}
            href="/credit/approvals"
          />
          <Stat label="Approved" value={String(approvedInPeriod.length)} sub={formatMoney(approvedInPeriod.reduce((s, l) => s + n(l.approved_amount), 0))} href={`/credit/reports/loan-applications?${query}&status=approved`} />
          <Stat label="Rejected" value={String(received.filter((l) => l.status === "rejected").length)} href={`/credit/reports/loan-applications?${query}&status=rejected`} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">Disbursements in the period</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Disbursed" value={formatMoney(disbursedInPeriod.reduce((s, l) => s + n(l.approved_amount), 0))} sub={`${disbursedInPeriod.length} loans`} href={`/credit/reports/loan-disbursements?${query}`} />
          <Stat label="Customers funded" value={String(new Set(disbursedInPeriod.map((l) => l.member_id)).size)} />
          <Stat label="Awaiting disbursement" value={String(awaiting.length)} sub={formatMoney(awaiting.reduce((s, l) => s + n(l.approved_amount), 0))} href="/credit/loans?status=approved" />
          <Stat label="Repaid in full" value={String(loans.filter((l) => l.closed_on && inPeriod(l.closed_on, from, to)).length)} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">Loan book today</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Outstanding principal" value={formatMoney(book.principal)} sub={`${book.loans} active loans, ${book.customers} customers`} href={`/credit/reports/loan-portfolio?${query}`} />
          <Stat label="Outstanding interest" value={formatMoney(book.interest)} />
          <Stat
            label="Overdue"
            value={formatMoney(book.overdue)}
            sub={`${book.overdueLoans} loans`}
            tone={book.overdue > 0 ? "red" : undefined}
            href={`/credit/reports/overdue-loans?${query}`}
          />
          <Stat
            label="Portfolio at risk (30 days)"
            value={pct(book.par30, book.principal)}
            sub={`Suggested provision ${formatMoney(book.provision)}`}
            tone={book.par30 > 0 ? "red" : undefined}
            href={`/credit/reports/loan-portfolio?${query}&group=arrears`}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="By branch" rows={breakdown((l) => branchName.get(l.branch_id) ?? "Unknown")} href={`/credit/reports/loan-portfolio?${query}&group=branch`} />
        <Breakdown title="By account officer" rows={breakdown((l) => officers.get(l.account_officer_id) ?? "Former officer")} href={`/credit/reports/officer-performance?${query}`} />
        <Breakdown title="By loan product" rows={breakdown((l) => l.product_name)} href={`/credit/reports/loan-portfolio?${query}&group=product`} />
        <Breakdown title="By customer category" rows={breakdown((l) => CUSTOMER_CATEGORIES[l.customer_category])} href={`/credit/reports/loan-portfolio?${query}&group=category`} />
      </div>

      <Card title="Pipeline (all dates)">
        <div className="flex flex-wrap gap-3 text-sm">
          {(Object.keys(LOAN_STATUSES) as LoanStatus[]).map((s) => (
            <Link key={s} href={`/credit/loans?status=${s}`} className="rounded-lg border border-zinc-200 px-3 py-2 hover:border-zinc-400">
              <span className="text-zinc-600">{LOAN_STATUSES[s].label}</span> <span className="ml-1 font-semibold tabular-nums">{count(s)}</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
