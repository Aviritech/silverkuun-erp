import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDateTime, formatMoney } from "@/lib/format";
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
};

export default async function InternalAuditPage() {
  const staff = await requireModule(internalAuditModule);
  const supabase = await createClient();
  const to = today();
  const from = `${to.slice(0, 7)}-01`;
  const [exceptions, ops, org] = await Promise.all([
    loadExceptions(supabase),
    supabase.rpc("branch_operations", { p_from: from, p_to: to, p_grain: "month", p_branch_id: null, p_region_id: null }),
    listOrg(),
  ]);
  if (ops.error) throw dbFailure(ops.error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));

  const bySeverity = (s: Severity) => exceptions.filter((e) => e.severity === s).length;
  const byCategory = new Map<ExceptionCategory, number>();
  for (const e of exceptions) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
  const branches = new Map<string, BranchRow>();
  for (const r of ops.data as BranchRow[]) {
    const b = branches.get(r.branch_id);
    if (!b) branches.set(r.branch_id, { ...r });
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Internal Audit"
        description="Read-only oversight of member files, money and changes across every branch you cover. Nothing here can be edited."
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {(Object.keys(SEVERITIES) as Severity[]).map((s) => (
          <Link
            key={s}
            href={`/internal-audit/reports/exceptions?severity=${s}`}
            className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400"
          >
            <p className="text-sm text-zinc-600">{SEVERITIES[s].label} exceptions</p>
            <p className="mt-1 text-2xl font-semibold">{bySeverity(s)}</p>
          </Link>
        ))}
        <Link href="/internal-audit/reports/customer-register?kyc=incomplete" className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400">
          <p className="text-sm text-zinc-600">Incomplete KYC files</p>
          <p className="mt-1 text-2xl font-semibold">{byCategory.get("incomplete_kyc") ?? 0}</p>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Exceptions by type" actions={<Link href="/internal-audit/reports/exceptions" className="text-sm underline">All exceptions</Link>}>
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

        <Card title="Needs attention first">
          {exceptions.length === 0 ? (
            <p className="text-sm text-zinc-600">Nothing to review.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {exceptions.slice(0, 8).map((e, i) => {
                const href = recordHref(e.record_type, e.record_id);
                return (
                  <li key={`${e.category}-${e.record_id}-${i}`} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {e.summary}
                        </Link>
                      ) : (
                        <span>{e.summary}</span>
                      )}
                      <Badge tone={SEVERITIES[e.severity].tone}>{SEVERITIES[e.severity].label}</Badge>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {e.branch_id ? branchName.get(e.branch_id) : "Organisation"}
                      {e.occurred_at && ` · ${formatDateTime(e.occurred_at)}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Branches this month"
        actions={<Link href="/internal-audit/reports/branch-operations" className="text-sm underline">Branch reports</Link>}
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
                <th className="py-1 text-right font-medium">Payments posted</th>
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
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(b.payments_total)}</td>
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
        {staff.permissions.has("audit.trail.read") && (
          <Link href="/internal-audit/reports/audit-trail" className="underline">
            Audit trail
          </Link>
        )}
      </div>
    </div>
  );
}
