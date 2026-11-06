import { ControlNote, StatCard, StatGrid } from "@/components/dashboard";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { RECEIVABLE_BANDS, activeLoans, loanAging, type ReceivableBand } from "@/modules/accounts/figures";
import { accountsModule } from "@/modules/accounts/module";

const BAND_BADGE = { current: "green", d1_30: "amber", d31_60: "red", d60_plus: "red" } as const;
const BAND_HINT = { current: "Scheduled balances not yet due", d1_30: "Follow up this week", d31_60: "Credit review", d60_plus: "Escalate" } as const;

export default async function ReceivablesAgingPage({ searchParams }: { searchParams: Promise<{ branch?: string; band?: string; officer?: string }> }) {
  await requireModule(accountsModule);
  await requirePermission("accounts.read");
  const params = await searchParams;
  const supabase = await createClient();
  const [loans, org, officers] = await Promise.all([activeLoans(supabase), listOrg(), supabase.rpc("credit_officers")]);
  if (officers.error) throw dbFailure(officers.error);
  const officerName = new Map((officers.data as { id: string; full_name: string }[]).map((o) => [o.id, o.full_name]));
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  const regionName = new Map(org.regions.map((r) => [r.id, r.name]));

  const aged = loans.map((l) => ({ ...l, ...loanAging(l) }));
  const totals = Object.fromEntries(RECEIVABLE_BANDS.map((b) => [b.key, 0])) as Record<ReceivableBand, number>;
  for (const l of aged) {
    totals.current += l.notYetDue;
    if (l.band !== "current") totals[l.band] += l.overdue;
  }

  const band = RECEIVABLE_BANDS.find((b) => b.key === params.band)?.key ?? "overdue";
  const list = aged
    .filter((l) => (band === "overdue" ? l.band !== "current" : l.band === band))
    .filter((l) => !params.branch || l.branch_id === params.branch)
    .filter((l) => !params.officer || l.account_officer_id === params.officer)
    .sort((a, b) => b.days_past_due - a.days_past_due || b.total - a.total);
  const listTotal = list.reduce((s, l) => s + (band === "current" ? l.notYetDue : l.overdue), 0);
  const branchesWithLoans = org.branches.filter((b) => loans.some((l) => l.branch_id === b.id));
  const officersWithLoans = [...new Set(loans.map((l) => l.account_officer_id).filter((id): id is string => Boolean(id)))];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Credit analysis"
        title="Receivables aging"
        description="What members owe on active loans, by how far behind they are, with the account officer following up."
        actions={
          <ButtonLink href="/accounts/reports/receivables-aging" variant="secondary">
            Export aging schedule
          </ButtonLink>
        }
      />
      <StatGrid>
        {RECEIVABLE_BANDS.map((b) => (
          <StatCard
            key={b.key}
            label={b.label}
            value={formatMoneyShort(totals[b.key])}
            hint={BAND_HINT[b.key]}
            icon={b.key === "current" ? "check" : b.key === "d1_30" ? "clock" : "alert"}
            tone={b.tone}
            href={`/accounts/receivables?band=${b.key}`}
          />
        ))}
      </StatGrid>

      <Card
        title={band === "current" ? "Loans with nothing overdue" : band === "overdue" ? "Loans in arrears" : `Loans ${RECEIVABLE_BANDS.find((b) => b.key === band)!.label.toLowerCase()}`}
        actions={
          <form className="flex flex-wrap gap-2" role="search">
            <div className="w-40">
              <Select name="branch" defaultValue={params.branch ?? ""} aria-label="Branch">
                <option value="">All branches</option>
                {branchesWithLoans.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-40">
              <Select name="band" defaultValue={band} aria-label="Aging band">
                <option value="overdue">All overdue</option>
                {RECEIVABLE_BANDS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-44">
              <Select name="officer" defaultValue={params.officer ?? ""} aria-label="Account officer">
                <option value="">All officers</option>
                {officersWithLoans.map((id) => (
                  <option key={id} value={id}>
                    {officerName.get(id) ?? "Account officer"}
                  </option>
                ))}
              </Select>
            </div>
            <button type="submit" className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
              Filter
            </button>
          </form>
        }
      >
        {list.length === 0 ? (
          <EmptyState>{band === "overdue" ? "No active loan is behind on its repayments." : "No loans match."}</EmptyState>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Member / loan</th>
                  <th className="px-5 py-2.5 font-medium">Location</th>
                  <th className="px-5 py-2.5 font-medium">Days overdue</th>
                  <th className="px-5 py-2.5 text-right font-medium">{band === "current" ? "Balance" : "Amount overdue"}</th>
                  <th className="px-5 py-2.5 text-right font-medium">Total owed</th>
                  <th className="px-5 py-2.5 font-medium">Next due</th>
                  <th className="px-5 py-2.5 font-medium">Follow-up</th>
                  <th className="px-5 py-2.5 font-medium">Band</th>
                </tr>
              </thead>
              <tbody>
                {list.map((l) => {
                  const b = RECEIVABLE_BANDS.find((x) => x.key === l.band)!;
                  return (
                    <tr key={l.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                      <td className="px-5 py-2.5">
                        {l.member_name}
                        <span className="block text-xs text-zinc-500">
                          {l.loan_no} · {l.product_name}
                        </span>
                      </td>
                      <td className="px-5 py-2.5">
                        {regionName.get(l.region_id)}
                        <span className="block text-xs text-zinc-500">{branchName.get(l.branch_id)}</span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                        {l.days_past_due ? `${l.days_past_due} days` : "—"}
                        {l.missed_repayments > 0 && <span className="block text-xs text-zinc-500">{l.missed_repayments} missed</span>}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(band === "current" ? l.notYetDue : l.overdue)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-zinc-600">{formatMoney(l.total)}</td>
                      <td className="whitespace-nowrap px-5 py-2.5">
                        {formatDate(l.next_due_date)}
                        {l.next_due_date && <span className="block text-xs text-zinc-500">{formatMoney(l.next_due_amount)}</span>}
                      </td>
                      <td className="px-5 py-2.5">{l.account_officer_id ? (officerName.get(l.account_officer_id) ?? "Account officer") : "—"}</td>
                      <td className="whitespace-nowrap px-5 py-2.5">
                        <Badge tone={BAND_BADGE[b.key]}>{b.short}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 font-medium">
                  <td className="px-5 py-2.5" colSpan={3}>
                    {list.length} loan{list.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(listTotal)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <ControlNote title="How aging works">
          A loan&apos;s overdue amount is the repayments (principal and interest) past their due date and still unpaid; it sits in the band of its
          oldest unpaid repayment. The rest of the loan counts as not yet due. Repayments are split between principal and interest when they post,
          and balances update then.
        </ControlNote>
      </Card>
    </div>
  );
}
