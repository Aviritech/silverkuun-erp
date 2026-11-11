import Link from "next/link";
import {
  ActivityList,
  AttentionPanel,
  StatCard,
  StatGrid,
  WorkQueues,
  firstName,
  greeting,
  workspaceEyebrow,
  type WorkQueue,
} from "@/components/dashboard";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDateTime, formatMoney, formatMoneyShort } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { today } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { EXCEPTION_CATEGORIES, SEVERITIES, recordHref, type ExceptionCategory, type Severity } from "@/modules/internal-audit/constants";
import { internalAuditModule } from "@/modules/internal-audit/module";
import { loadExceptions } from "@/modules/internal-audit/reports";

type BranchRow = {
  branch_id: string;
  branch_name: string;
  registrations: number;
  approvals: number;
  contributions_total: string;
  unverified_count: number;
  receipts_total: string;
  payments_total: string;
  loans_disbursed_total: string;
  loan_repayments_total: string;
};

export default async function InternalAuditPage() {
  const staff = await requireModule(internalAuditModule);
  const supabase = await createClient();
  const to = today();
  const from = `${to.slice(0, 7)}-01`;
  const p = staff.permissions;
  const none = Promise.resolve({ data: [] as unknown[], error: null });
  const [exceptions, ops, org, payments, cases] = await Promise.all([
    loadExceptions(supabase),
    supabase.rpc("branch_operations", { p_from: from, p_to: to, p_grain: "month", p_branch_id: null, p_region_id: null }),
    listOrg(),
    p.has("audit.payments.approve")
      ? supabase.from("finance_transactions").select("id, amount").eq("direction", "payment").eq("status", "approved").is("audited_at", null)
      : none,
    p.has("whistleblowing.manage") ? supabase.from("whistleblowing_reports").select("id, status").in("status", ["received", "investigating"]) : none,
  ]);
  for (const r of [ops, payments, cases]) if (r.error) throw dbFailure(r.error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));

  const bySeverity = (s: Severity) => exceptions.filter((e) => e.severity === s).length;
  const byCategory = new Map<ExceptionCategory, number>();
  for (const e of exceptions) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
  const paymentRows = (payments.data ?? []) as { id: string; amount: string }[];
  const paymentsValue = paymentRows.reduce((sum, t) => sum + Number(t.amount), 0);
  const caseRows = (cases.data ?? []) as { id: string; status: string }[];
  const newCases = caseRows.filter((c) => c.status === "received").length;
  const waiting = paymentRows.length + newCases;
  const queues: WorkQueue[] = [
    p.has("audit.payments.approve") && { label: "Payments to approve", value: paymentRows.length, href: "/internal-audit/payments", hint: formatMoneyShort(paymentsValue) },
    { label: "High-severity exceptions", value: bySeverity("high"), href: "/internal-audit/reports/exceptions?severity=high" },
    { label: "Incomplete KYC files", value: byCategory.get("incomplete_kyc") ?? 0, href: "/internal-audit/reports/customer-register?kyc=incomplete" },
    p.has("whistleblowing.manage") && { label: "Reports not yet picked up", value: newCases, href: "/internal-audit/whistleblowing?status=received" },
    p.has("whistleblowing.manage") && { label: "Cases under investigation", value: caseRows.length - newCases, href: "/internal-audit/whistleblowing?status=investigating" },
  ].filter((q): q is WorkQueue => !!q);
  const attention =
    p.has("audit.payments.approve") && (paymentRows.length > 0 || newCases === 0)
      ? { href: "/internal-audit/payments", cta: "Open payments" }
      : p.has("whistleblowing.manage")
        ? { href: "/internal-audit/whistleblowing", cta: "Open cases" }
        : { href: "/internal-audit/reports/exceptions", cta: "Open exceptions" };
  const branches = new Map<string, BranchRow>();
  for (const r of ops.data as BranchRow[]) {
    const b = branches.get(r.branch_id);
    if (!b) branches.set(r.branch_id, { ...r });
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow={workspaceEyebrow("Internal Audit")}
        title={`${greeting()}, ${firstName(staff.fullName)}`}
        description="Read-only oversight of member files, money and changes across every branch you cover. Nothing here can be edited."
      />

      <StatGrid>
        <StatCard
          label="Open exceptions"
          icon="alert"
          tone={bySeverity("high") > 0 ? "bad" : "neutral"}
          value={exceptions.length.toLocaleString("en-NG")}
          hint={`${bySeverity("high")} high · ${bySeverity("medium")} medium · ${bySeverity("low")} low`}
          href="/internal-audit/reports/exceptions"
        />
        {p.has("audit.payments.approve") ? (
          <StatCard label="Payments waiting for audit" icon="shield" value={formatMoneyShort(paymentsValue)} hint={`${paymentRows.length} approved by Accounts, not yet paid`} href="/internal-audit/payments" />
        ) : (
          <StatCard label="Incomplete KYC files" icon="file" value={(byCategory.get("incomplete_kyc") ?? 0).toLocaleString("en-NG")} href="/internal-audit/reports/customer-register?kyc=incomplete" />
        )}
        <StatCard
          label="Collected this month"
          icon="savings"
          value={formatMoneyShort([...branches.values()].reduce((sum, b) => sum + Number(b.contributions_total), 0))}
          hint={`${[...branches.values()].reduce((sum, b) => sum + b.unverified_count, 0)} contributions not yet verified`}
          href="/internal-audit/reports/branch-operations"
        />
        <StatCard
          label="Loans disbursed this month"
          icon="loan"
          value={formatMoneyShort([...branches.values()].reduce((sum, b) => sum + Number(b.loans_disbursed_total), 0))}
          hint={`Repayments ${formatMoneyShort([...branches.values()].reduce((sum, b) => sum + Number(b.loan_repayments_total), 0))}`}
          href="/internal-audit/reports/branch-operations"
        />
      </StatGrid>

      <WorkQueues queues={queues} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Needs attention first" actions={<Link href="/internal-audit/reports/exceptions" className="text-xs font-medium text-brand-700 underline">All exceptions</Link>}>
            <ActivityList
              empty="Nothing to review."
              items={exceptions.slice(0, 8).map((e, i) => ({
                key: `${e.category}-${e.record_id}-${i}`,
                title: e.summary,
                href: recordHref(e.record_type, e.record_id) ?? undefined,
                meta: `${EXCEPTION_CATEGORIES[e.category] ?? e.category} · ${e.branch_id ? branchName.get(e.branch_id) : "Organisation"}${e.occurred_at ? ` · ${formatDateTime(e.occurred_at)}` : ""}`,
                aside: <Badge tone={SEVERITIES[e.severity].tone}>{SEVERITIES[e.severity].label}</Badge>,
              }))}
            />
          </Card>
        </div>
        <div className="space-y-6">
          <AttentionPanel
            count={waiting}
            title={waiting ? "Items waiting for you" : "Nothing waiting for you"}
            href={attention.href}
            cta={attention.cta}
          >
            {waiting
              ? "Payments Accounts has approved wait for your approval before they go out, plus any new whistleblowing reports."
              : "When a payment needs your approval or a new report comes in, it appears here."}
          </AttentionPanel>
          <Card title="Exceptions by type">
            {byCategory.size === 0 ? (
              <p className="text-sm text-zinc-600">No exceptions found.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {[...byCategory].sort((a, b) => b[1] - a[1]).map(([c, count]) => (
                  <li key={c} className="flex justify-between py-2">
                    <Link href={`/internal-audit/reports/exceptions?category=${c}`} className="hover:underline">
                      {EXCEPTION_CATEGORIES[c] ?? c}
                    </Link>
                    <span className="tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="Branches this month"
        actions={<Link href="/internal-audit/reports/branch-operations" className="text-xs font-medium text-brand-700 underline">Branch reports</Link>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Branch</th>
                <th className="py-1 pr-3 text-right font-medium">New files</th>
                <th className="py-1 pr-3 text-right font-medium">Approved</th>
                <th className="py-1 pr-3 text-right font-medium">Collected</th>
                <th className="py-1 pr-3 text-right font-medium">Unverified</th>
                <th className="py-1 pr-3 text-right font-medium">Receipts posted</th>
                <th className="py-1 pr-3 text-right font-medium">Payments posted</th>
                <th className="py-1 pr-3 text-right font-medium">Loans disbursed</th>
                <th className="py-1 text-right font-medium">Loan repayments</th>
              </tr>
            </thead>
            <tbody>
              {[...branches.values()].map((b) => (
                <tr key={b.branch_id} className="border-t border-zinc-100">
                  <td className="py-1.5 pr-3">{b.branch_name}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{b.registrations}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{b.approvals}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(b.contributions_total)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{b.unverified_count}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(b.receipts_total)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(b.payments_total)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(b.loans_disbursed_total)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(b.loan_repayments_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-wrap gap-4 text-sm">
        {staff.permissions.has("accounts.read") && (
          <Link href="/accounts/reports" className="underline">
            Financial reports
          </Link>
        )}
        {staff.permissions.has("credit.read") && (
          <Link href="/credit/reports" className="underline">
            Loan reports
          </Link>
        )}
        {staff.permissions.has("audit.trail.read") && (
          <Link href="/internal-audit/reports/audit-trail" className="underline">
            Audit trail
          </Link>
        )}
      </div>
    </div>
  );
}
