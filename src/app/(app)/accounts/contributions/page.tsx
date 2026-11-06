import Link from "next/link";
import { ControlNote, StatCard, StatGrid } from "@/components/dashboard";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { addDays } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { postContribution } from "@/modules/accounts/actions";
import { ContributionPostForm } from "@/modules/accounts/components/contribution-post-form";
import { accountsModule } from "@/modules/accounts/module";
import { MATCH_WINDOW, checkPayIns, type StatementLine } from "@/modules/accounts/payin-checks";
import { listBankAccounts } from "@/modules/accounts/queries";
import { CONTRIBUTION_KINDS, PAYMENT_METHODS } from "@/modules/administration/constants";

type C = {
  id: string;
  member_id: string;
  member_name: string;
  membership_no: string | null;
  branch_id: string;
  kind: keyof typeof CONTRIBUTION_KINDS;
  amount: string;
  paid_on: string;
  payment_method: keyof typeof PAYMENT_METHODS;
  reference: string | null;
};

export default async function SavingsPayInsPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.receipts.record");
  const supabase = await createClient();
  const [{ data, error }, banks, org, waitingOps] = await Promise.all([
    supabase.from("contributions_awaiting_posting").select("*").order("paid_on"),
    listBankAccounts(),
    listOrg(),
    supabase
      .from("finance_transactions")
      .select("id, txn_no, txn_date, amount, branch_id, members(first_name, last_name)")
      .eq("status", "submitted")
      .eq("needs_ops_confirmation", true)
      .is("ops_confirmed_at", null)
      .order("txn_date")
      .limit(100),
  ]);
  if (error) throw dbFailure(error);
  if (waitingOps.error) throw dbFailure(waitingOps.error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));
  const list = (data as C[]).filter((c) => {
    const branch = org.branches.find((b) => b.id === c.branch_id);
    return branch && staff.permissions.hasForBranch("accounts.receipts.record", branch);
  });

  // Evidence: unmatched money-in bank lines and receipts already recorded around the pay-in dates.
  let lines: StatementLine[] = [];
  let receipts: { id: string; txn_no: string; member_id: string; amount: number; txn_date: string }[] = [];
  if (list.length) {
    const dates = list.map((c) => c.paid_on).sort();
    const [lineRes, receiptRes] = await Promise.all([
      supabase
        .from("bank_statement_lines")
        .select("id, bank_account_id, branch_id, line_date, amount, reference, description")
        .eq("status", "unmatched")
        .gt("amount", 0)
        .gte("line_date", addDays(dates[0], -MATCH_WINDOW.before))
        .lte("line_date", addDays(dates[dates.length - 1], MATCH_WINDOW.after))
        .in("branch_id", [...new Set(list.map((c) => c.branch_id))])
        .limit(5000),
      supabase
        .from("finance_transactions")
        .select("id, txn_no, member_id, amount, txn_date")
        .eq("direction", "receipt")
        .not("status", "in", "(rejected,reversed)")
        .in("member_id", [...new Set(list.map((c) => c.member_id))])
        .gte("txn_date", dates[0])
        .lte("txn_date", dates[dates.length - 1])
        .limit(5000),
    ]);
    if (lineRes.error) throw dbFailure(lineRes.error);
    if (receiptRes.error) throw dbFailure(receiptRes.error);
    lines = lineRes.data.map((l) => ({ ...l, amount: Number(l.amount) }));
    receipts = receiptRes.data.filter((r) => r.member_id).map((r) => ({ ...r, member_id: r.member_id!, amount: Number(r.amount) }));
  }
  const checks = checkPayIns(
    list.map((c) => ({ ...c, amount: Number(c.amount) })),
    lines,
    receipts,
  );
  const matched = list.filter((c) => checks.get(c.id)?.line).length;
  const cash = list.filter((c) => c.payment_method === "cash").length;
  const duplicates = list.filter((c) => checks.get(c.id)?.duplicateOf).length;
  const total = list.reduce((s, c) => s + Number(c.amount), 0);
  type Ops = { id: string; txn_no: string; txn_date: string; amount: string; branch_id: string; members: { first_name: string; last_name: string } | null };
  const opsList = waitingOps.data as unknown as Ops[];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Member receipts"
        title="Savings pay-in confirmation"
        description="Pay-ins Operations recorded and the Branch Manager verified. Check each against the bank or cash evidence, say which account the money went into, and send it for confirmation; once approved it posts to the member's savings."
        actions={
          <ButtonLink href="/accounts/bank" variant="secondary">
            Import bank statement
          </ButtonLink>
        }
      />
      <StatGrid>
        <StatCard label="Waiting to post" icon="clock" value={list.length} hint={`${formatMoneyShort(total)} across your branches`} />
        <StatCard label="Bank line found" icon="check" tone="good" value={matched} hint="Same amount and branch on an unmatched statement line" />
        <StatCard
          label="No bank line yet"
          icon="alert"
          tone={list.length - matched - cash > 0 ? "warn" : "neutral"}
          value={list.length - matched - cash}
          hint={cash ? `Plus ${cash} cash pay-in${cash === 1 ? "" : "s"}: check the cash book` : "Import the latest statement, or check the reference"}
        />
        <StatCard label="Possible duplicates" icon="alert" tone={duplicates ? "bad" : "neutral"} value={duplicates} hint="Same member, amount and day as another record" />
      </StatGrid>

      <Card title={`Savings pay-ins to confirm (${list.length})`}>
        {list.length === 0 ? (
          <EmptyState>Nothing is waiting. Verified pay-ins from Operations appear here automatically.</EmptyState>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Member</th>
                  <th className="px-5 py-2.5 font-medium">Branch</th>
                  <th className="px-5 py-2.5 font-medium">Paid</th>
                  <th className="px-5 py-2.5 font-medium">Bank / cash evidence</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 font-medium">Post to</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const check = checks.get(c.id)!;
                  const choices = banks.filter((b) => b.is_active && b.branch_id === c.branch_id);
                  const preferred =
                    (check.line && choices.find((b) => b.id === check.line!.bank_account_id)) ??
                    choices.find((b) => (c.payment_method === "cash" ? b.kind === "cash" : b.kind === "bank"));
                  return (
                    <tr key={c.id} className="border-b border-zinc-100 align-top last:border-0">
                      <td className="px-5 py-3">
                        {c.member_name}
                        <span className="block text-xs text-zinc-500">
                          {c.membership_no} · {CONTRIBUTION_KINDS[c.kind]}
                        </span>
                      </td>
                      <td className="px-5 py-3">{branchName.get(c.branch_id)}</td>
                      <td className="px-5 py-3">
                        {formatDate(c.paid_on)}
                        <span className="block text-xs text-zinc-500">
                          {PAYMENT_METHODS[c.payment_method]}
                          {c.reference && <span className="font-mono"> · {c.reference}</span>}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {check.line ? (
                          <>
                            <Badge tone="green">Bank line found</Badge>
                            <span className="mt-1 block text-xs text-zinc-500">
                              {bankName.get(check.line.bank_account_id)} · {formatDate(check.line.line_date)}
                              {check.line.reference && <span className="font-mono"> · {check.line.reference}</span>}
                            </span>
                          </>
                        ) : c.payment_method === "cash" ? (
                          <Badge tone="gray">Cash: check the cash book</Badge>
                        ) : (
                          <Badge tone="amber">No bank line yet</Badge>
                        )}
                        {check.duplicateOf && (
                          <span className="mt-1 block">
                            <Badge tone="red">Possible duplicate</Badge>
                            <span className="mt-1 block text-xs text-zinc-500">
                              {check.duplicateOf.kind === "receipt" ? (
                                <>
                                  Same as{" "}
                                  <Link href={`/accounts/transactions/${check.duplicateOf.id}`} className="underline">
                                    {check.duplicateOf.txn_no}
                                  </Link>
                                </>
                              ) : (
                                "Another pay-in on this list matches"
                              )}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatMoney(c.amount)}</td>
                      <td className="px-5 py-3">
                        <ContributionPostForm action={postContribution.bind(null, c.id)} banks={choices} defaultBankId={preferred?.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ControlNote title="Confirmation control">
          Sending a pay-in creates a receipt that someone else approves before it posts to the member&apos;s savings and the chosen bank or cash
          account. Bank lines are suggestions only (same branch and amount, dated up to {MATCH_WINDOW.before} day before or {MATCH_WINDOW.after} days
          after); match them on the bank reconciliation screen once the receipt posts.
        </ControlNote>
      </Card>

      {opsList.length > 0 && (
        <Card title={`Member receipts keyed in by Accounts, waiting for Operations to check (${opsList.length})`}>
          <ul className="divide-y divide-zinc-100 text-sm">
            {opsList.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/accounts/transactions/${t.id}`} className="font-mono text-xs hover:underline">
                    {t.txn_no}
                  </Link>{" "}
                  {t.members ? `${t.members.first_name} ${t.members.last_name}` : "A member"}
                  <span className="text-xs text-zinc-500">
                    {" "}
                    · {branchName.get(t.branch_id)} · {formatDate(t.txn_date)}
                  </span>
                </span>
                <span className="tabular-nums">{formatMoney(t.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
