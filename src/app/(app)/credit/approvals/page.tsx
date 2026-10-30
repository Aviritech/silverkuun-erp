import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { RISK_RATINGS, type RiskRating } from "@/modules/credit/constants";
import { creditModule } from "@/modules/credit/module";
import { officerNames, type LoanBookRow, type Restructure } from "@/modules/credit/queries";

type Queued = LoanBookRow & {
  created_by: string;
  submitted_by: string | null;
  appraised_by: string | null;
  approved_by: string | null;
  recommended_amount: string | null;
};

function daysSince(iso: string | null) {
  return iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : 0;
}

export default async function ApprovalsPage() {
  const staff = await requireModule(creditModule);
  await requirePermission("credit.read");
  const supabase = await createClient();
  const [queue, people, restructures, org, officers] = await Promise.all([
    supabase.from("loan_book").select("*").in("status", ["submitted", "appraised", "credit_approved", "returned"]).order("submitted_at"),
    supabase.from("loans").select("id, created_by, submitted_by, appraised_by, approved_by, recommended_amount").in("status", ["submitted", "appraised", "credit_approved", "returned"]),
    supabase.from("loan_restructures").select("*, loans(loan_no, member_id)").eq("status", "pending").order("requested_at"),
    listOrg(),
    officerNames(),
  ]);
  for (const r of [queue, people, restructures]) if (r.error) throw dbFailure(r.error);
  const extra = new Map((people.data as Queued[]).map((p) => [p.id, p]));
  const loans = (queue.data as LoanBookRow[]).map((l) => ({ ...l, ...extra.get(l.id) }) as Queued);
  const branchOf = new Map(org.branches.map((b) => [b.id, b]));
  const can = (p: string, branchId: string) => staff.permissions.hasForBranch(p, branchOf.get(branchId)!);
  const mine = (l: Queued) => [l.created_by, l.submitted_by, l.account_officer_id].includes(staff.id);

  const sections: { title: string; hint: string; rows: Queued[]; action: (l: Queued) => string | null }[] = [
    {
      title: "Awaiting appraisal",
      hint: "Submitted by account officers. A credit analyst checks the bureau, rates the risk and recommends.",
      rows: loans.filter((l) => l.status === "submitted"),
      action: (l) => (can("credit.appraise", l.branch_id) && !mine(l) ? "Appraise" : null),
    },
    {
      title: "Awaiting Head of Credit",
      hint: "Appraised and recommended. The Head of Credit approves, returns or rejects.",
      rows: loans.filter((l) => l.status === "appraised"),
      action: (l) => (can("credit.approve", l.branch_id) && !mine(l) && l.appraised_by !== staff.id ? "Decide" : null),
    },
    {
      title: "Awaiting Head of Business",
      hint: "Approved by the Head of Credit. The Head of Business gives the final approval before Accounts pays it out.",
      rows: loans.filter((l) => l.status === "credit_approved"),
      action: (l) =>
        can("credit.business_approve", l.branch_id) && !mine(l) && ![l.appraised_by, l.approved_by].includes(staff.id) ? "Approve" : null,
    },
    {
      title: "Returned to the officer",
      hint: "Sent back for correction before it can be resubmitted.",
      rows: loans.filter((l) => l.status === "returned"),
      action: (l) => (can("credit.manage", l.branch_id) ? "Correct" : null),
    },
  ];
  const pending = restructures.data as (Restructure & { loans: { loan_no: string } })[];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Approvals" description="Applications and restructures waiting on someone in Credit. Each step must be done by a different person from the one before." />
      {sections.map((s) => (
        <Card key={s.title} title={`${s.title} (${s.rows.length})`}>
          <p className="mb-3 text-xs text-zinc-500">{s.hint}</p>
          {s.rows.length === 0 ? (
            <EmptyState>Nothing waiting.</EmptyState>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1 font-medium">Loan</th>
                  <th className="py-1 font-medium">Customer</th>
                  <th className="py-1 font-medium">Product</th>
                  <th className="py-1 font-medium">Officer</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                  <th className="py-1 pl-4 font-medium">Risk</th>
                  <th className="py-1 text-right font-medium">Waiting</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {s.rows.map((l) => {
                  const action = s.action(l);
                  const since =
                    l.status === "appraised"
                      ? l.appraised_at
                      : l.status === "credit_approved"
                        ? l.approved_at
                        : l.status === "returned"
                          ? l.decided_at
                          : l.submitted_at;
                  return (
                    <tr key={l.id} className="border-t border-zinc-100">
                      <td className="py-1.5">
                        <Link href={`/credit/loans/${l.id}`} className="font-mono text-xs underline">
                          {l.loan_no}
                        </Link>
                        <div className="text-xs text-zinc-500">{branchOf.get(l.branch_id)?.name}</div>
                      </td>
                      <td className="py-1.5">{l.member_name}</td>
                      <td className="py-1.5">{l.product_name}</td>
                      <td className="py-1.5">{officers.get(l.account_officer_id) ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatMoney(l.amount_requested)}
                        {l.recommended_amount && l.recommended_amount !== l.amount_requested && (
                          <span className="block text-xs text-zinc-500">recommended {formatMoney(l.recommended_amount)}</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-4">{l.risk_rating && <Badge tone={RISK_RATINGS[l.risk_rating as RiskRating].tone}>{RISK_RATINGS[l.risk_rating as RiskRating].label}</Badge>}</td>
                      <td className={`py-1.5 text-right tabular-nums ${daysSince(since) > 7 ? "text-red-700" : ""}`}>{daysSince(since)} days</td>
                      <td className="py-1.5 text-right">
                        {action && (
                          <Link href={`/credit/loans/${l.id}`} className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-white">
                            {action}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      ))}
      <Card title={`Restructures awaiting approval (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>Nothing waiting.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <Link href={`/credit/loans/${r.loan_id}`} className="font-mono text-xs underline">
                    {r.loans.loan_no}
                  </Link>{" "}
                  to {r.tenor_months} months from {formatDate(r.first_repayment_date)}
                  <span className="block text-xs text-zinc-500">{r.reason}</span>
                </span>
                {staff.permissions.has("credit.approve") && r.requested_by !== staff.id && (
                  <Link href={`/credit/loans/${r.loan_id}`} className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-white">
                    Decide
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
