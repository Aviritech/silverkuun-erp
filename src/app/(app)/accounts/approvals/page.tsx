import Link from "next/link";
import { ControlNote, StatCard, StatGrid } from "@/components/dashboard";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { APPROVAL_KINDS, loadApprovals, type ApprovalKind } from "@/modules/accounts/approvals";
import { financeStatus, type FinanceStatus } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";

function waited(since: string | null) {
  if (!since) return "";
  const days = Math.floor((Date.now() - Date.parse(since)) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
}

export default async function AccountsApprovalsPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const supabase = await createClient();
  const org = await listOrg();
  const [items, mine] = await Promise.all([
    loadApprovals(supabase, staff, org.branches),
    supabase
      .from("finance_transactions")
      .select("id, txn_no, direction, status, audited_at, needs_ops_confirmation, ops_confirmed_at, amount, counterparty, submitted_at, members(first_name, last_name)")
      .eq("created_by", staff.id)
      .in("status", ["submitted", "approved", "returned"])
      .order("submitted_at", { ascending: false })
      .limit(50),
  ]);
  if (mine.error) throw dbFailure(mine.error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  const kinds = Object.keys(APPROVAL_KINDS) as ApprovalKind[];
  const totalOf = (k: ApprovalKind) => items.filter((i) => i.kind === k);
  type Mine = {
    id: string; txn_no: string; direction: "receipt" | "payment"; status: FinanceStatus; audited_at: string | null; needs_ops_confirmation: boolean;
    ops_confirmed_at: string | null; amount: string; counterparty: string | null; submitted_at: string | null; members: { first_name: string; last_name: string } | null;
  };
  const own = mine.data as unknown as Mine[];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Separation of duties"
        title="Approvals"
        description="Everything waiting for you to approve, pay or post, oldest first. Nobody approves or pays their own request; the database refuses it."
      />
      <StatGrid>
        <StatCard label="To approve" icon="check" value={totalOf("approve_transaction").length + totalOf("approve_bill").length} hint="Receipts, payment requests and supplier bills" />
        <StatCard label="Ready to pay" icon="bank" value={totalOf("pay").length} hint="Approved by Internal Audit" />
        <StatCard label="Journals to post" icon="bill" value={totalOf("post_journal").length} hint="Drafts prepared by someone else" />
        <StatCard label="Your requests in progress" icon="clock" value={own.length} hint="Waiting for someone else, or returned to you" />
      </StatGrid>

      {items.length === 0 && (
        <Card>
          <EmptyState>Nothing is waiting for you. Requests other people send you to approve, pay or post appear here.</EmptyState>
        </Card>
      )}
      {kinds.map((k) => {
        const list = totalOf(k);
        if (!list.length) return null;
        return (
          <Card key={k} title={`${APPROVAL_KINDS[k].label} (${list.length})`}>
            <ul className="-my-2 divide-y divide-zinc-100">
              {list.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {i.detail} · {i.title}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {branchName.get(i.branch_id)} · <span className="font-mono">{i.ref}</span> · waiting {waited(i.waitingSince)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {i.amount !== null && <span className="tabular-nums font-medium">{formatMoney(i.amount)}</span>}
                    <ButtonLink href={i.href} variant="secondary" className="py-1.5">
                      {APPROVAL_KINDS[i.kind].verb}
                    </ButtonLink>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      {own.length > 0 && (
        <Card title="Your requests in progress">
          <ul className="-my-2 divide-y divide-zinc-100 text-sm">
            {own.map((t) => {
              const st = financeStatus(t);
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span>
                    <Link href={`/accounts/transactions/${t.id}`} className="font-mono text-xs hover:underline">
                      {t.txn_no}
                    </Link>{" "}
                    {t.counterparty ?? (t.members ? `${t.members.first_name} ${t.members.last_name}` : "A member")}
                    <span className="text-xs text-zinc-500"> · sent {formatDate(t.submitted_at)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="tabular-nums">{formatMoney(t.amount)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <ControlNote>
        The person making a payment does not approve their own request. Payments also need Internal Audit&apos;s approval before they are paid,
        and member savings keyed in by Accounts need Operations to check them first; those wait on the other department, so they appear here once
        it is your turn.
      </ControlNote>
    </div>
  );
}
