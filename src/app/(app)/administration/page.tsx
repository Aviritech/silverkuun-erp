import Link from "next/link";
import {
  ActivityList,
  AttentionPanel,
  ProcessSteps,
  StatCard,
  StatGrid,
  WorkQueues,
  firstName,
  greeting,
  workspaceEyebrow,
  type WorkQueue,
} from "@/components/dashboard";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDateTime, formatMoneyShort } from "@/lib/format";
import { addDays, today as todayIso } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES, type MemberStatus } from "@/modules/administration/constants";
import { administrationModule } from "@/modules/administration/module";
import { listBranches, listLiquidations, memberCounts } from "@/modules/administration/queries";

const STEPS = [
  { title: "Capture", text: "The officer opens the member file with KYC and documents" },
  { title: "Marketer", text: "The marketer confirms they know the member" },
  { title: "Complete", text: "The officer finishes the file and submits it" },
  { title: "Approve", text: "The Branch Manager signs and approves" },
  { title: "Save", text: "Contributions are recorded against the savings plan" },
  { title: "Accounts", text: "Accounts posts each pay-in once Operations confirms it" },
];

type QueuedMember = { id: string; branch_id: string; status: MemberStatus; created_by: string; sent_to_marketer_by: string | null };
type RecentMember = {
  id: string;
  branch_id: string;
  status: MemberStatus;
  membership_no: string | null;
  first_name: string;
  last_name: string;
  created_at: string;
};

export default async function AdministrationPage() {
  const staff = await requireModule(administrationModule);
  const supabase = await createClient();
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  const p = staff.permissions;
  const canRead = p.has("members.read");

  const [counts, branches, queued, receipts, liquidations, collected, maturing, recent] = await Promise.all([
    memberCounts(),
    listBranches(),
    supabase.from("members").select("id, branch_id, status, created_by, sent_to_marketer_by").in("status", ["with_marketer", "pending_approval", "marketer_reviewed", "returned"]),
    p.has("receipts.confirm") ? supabase.rpc("receipts_to_confirm") : Promise.resolve({ data: [], error: null }),
    p.has("liquidations.request") || p.has("liquidations.approve") ? listLiquidations(["pending_approval", "returned"]) : Promise.resolve([]),
    canRead
      ? supabase.from("contributions").select("amount, kind, verified_at").gte("paid_on", monthStart).lte("paid_on", today).limit(10000)
      : Promise.resolve({ data: [], error: null }),
    canRead
      ? supabase
          .from("member_plans")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .gte("maturity_date", today)
          .lte("maturity_date", addDays(today, 30))
      : Promise.resolve({ count: 0, error: null }),
    canRead
      ? supabase.from("members").select("id, branch_id, status, membership_no, first_name, last_name, created_at").order("created_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [queued, receipts, collected, maturing, recent]) if (r.error) throw dbFailure(r.error);

  const branchOf = new Map(branches.map((b) => [b.id, b]));
  const inBranch = (permission: string) => (row: { branch_id: string }) => {
    const b = branchOf.get(row.branch_id);
    return !!b && p.hasForBranch(permission, b);
  };
  const files = (queued.data ?? []) as QueuedMember[];
  const forMarketer = p.has("members.endorse")
    ? files.filter((m) => m.status === "with_marketer").filter(inBranch("members.endorse")).filter((m) => ![m.created_by, m.sent_to_marketer_by].includes(staff.id)).length
    : 0;
  const forManager = p.has("members.approve") ? files.filter((m) => m.status === "pending_approval").filter(inBranch("members.approve")).length : 0;
  const backWithMe = files.filter((m) => ["marketer_reviewed", "returned"].includes(m.status) && m.created_by === staff.id).length;
  const receiptsToCheck = ((receipts.data ?? []) as unknown[]).length;
  const liquidationsToApprove = liquidations.filter((l) => l.status === "pending_approval").filter(inBranch("liquidations.approve")).length;
  const liquidationsReturned = liquidations.filter((l) => l.status === "returned" && l.requested_by === staff.id).length;
  const waiting = forMarketer + forManager + receiptsToCheck + liquidationsToApprove;

  const pay = (collected.data ?? []) as { amount: string; kind: string; verified_at: string | null }[];
  const collectedTotal = pay.reduce((s, c) => s + Number(c.amount), 0);
  const unverified = pay.filter((c) => c.kind !== "reversal" && !c.verified_at).length;
  const inProgress = (Object.keys(counts) as MemberStatus[]).filter((s) => s !== "approved").reduce((s, k) => s + counts[k], 0);
  const totalFiles = inProgress + counts.approved;

  const queues: WorkQueue[] = [
    p.has("members.endorse") && { label: "Files to confirm as marketer", value: forMarketer, href: "/administration/approvals" },
    p.has("members.approve") && { label: "Files to approve", value: forManager, href: "/administration/approvals" },
    p.has("receipts.confirm") && { label: "Receipts to check", value: receiptsToCheck, href: "/administration/receipts" },
    p.has("liquidations.approve") && { label: "Liquidations to approve", value: liquidationsToApprove, href: "/administration/liquidations" },
    p.has("liquidations.request") && { label: "Liquidations sent back to you", value: liquidationsReturned, href: "/administration/liquidations" },
    p.has("members.manage") && { label: "Files back with you", value: backWithMe, href: "/administration/members?status=returned", hint: "Returned or confirmed by the marketer" },
  ].filter((q): q is WorkQueue => !!q);

  const pipeline = (Object.keys(MEMBER_STATUSES) as MemberStatus[]).filter((s) => s !== "approved");
  const recentRows = (recent.data ?? []) as RecentMember[];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow={workspaceEyebrow("Operations")}
        title={`${greeting()}, ${firstName(staff.fullName)}`}
        description="Member files, receipts and liquidations across the branches you work in."
        actions={
          <>
            {p.has("liquidations.request") && (
              <ButtonLink href="/administration/liquidations" variant="secondary">
                Liquidations
              </ButtonLink>
            )}
            {p.has("members.manage") && <ButtonLink href="/administration/members/new">New member</ButtonLink>}
          </>
        }
      />

      {canRead && (
        <StatGrid>
          <StatCard label="Approved members" icon="users" value={counts.approved.toLocaleString("en-NG")} hint={`${totalFiles.toLocaleString("en-NG")} member files in all`} href="/administration/members?status=approved" />
          <StatCard
            label="Files in progress"
            icon="file"
            value={inProgress.toLocaleString("en-NG")}
            hint={`${counts.pending_approval} with the Branch Manager · ${counts.returned} returned`}
            tone={counts.returned > 0 ? "warn" : "neutral"}
            href="/administration/members"
          />
          <StatCard
            label="Savings collected this month"
            icon="savings"
            value={formatMoneyShort(collectedTotal)}
            hint={unverified ? `${unverified} pay-ins not yet verified` : "All pay-ins verified"}
            href="/administration/reports"
          />
          <StatCard label="Plans maturing in 30 days" icon="calendar" value={(maturing.count ?? 0).toLocaleString("en-NG")} hint="Active savings plans due to mature" href="/administration/reports/maturities" />
        </StatGrid>
      )}

      <WorkQueues queues={queues} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Member files by stage" actions={<Link href="/administration/members" className="text-xs font-medium text-brand-700 underline">All members</Link>}>
            {inProgress === 0 ? (
              <p className="text-sm text-zinc-600">No member files are in progress.</p>
            ) : (
              <ul className="space-y-3">
                {pipeline.map((s) => (
                  <li key={s}>
                    <Link href={`/administration/members?status=${s}`} className="group block">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-700 group-hover:underline">{MEMBER_STATUSES[s].label}</span>
                        <span className="font-medium tabular-nums text-ink">{counts[s]}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
                        <div className={`h-full rounded-full ${s === "returned" ? "bg-red-400" : "bg-brand"}`} style={{ width: `${(counts[s] / inProgress) * 100}%` }} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <AttentionPanel
          count={waiting}
          title={waiting ? "Items waiting for you" : "Nothing waiting for you"}
          href={forMarketer + forManager ? "/administration/approvals" : receiptsToCheck ? "/administration/receipts" : liquidationsToApprove ? "/administration/liquidations" : "/administration/members"}
          cta={forMarketer + forManager ? "Open approvals" : receiptsToCheck ? "Check receipts" : liquidationsToApprove ? "Open liquidations" : "Open members"}
        >
          {waiting
            ? "Member files to confirm or approve, receipts to check and liquidations to decide. Nobody approves their own work."
            : "When a member file, receipt or liquidation needs you, it appears here."}
        </AttentionPanel>
      </div>

      {canRead && (
        <Card title="Recently opened member files" actions={<Link href="/administration/members" className="text-xs font-medium text-brand-700 underline">All members</Link>}>
          <ActivityList
            empty="No member files yet."
            items={recentRows.map((m) => ({
              key: m.id,
              title: `${m.first_name} ${m.last_name}`,
              href: `/administration/members/${m.id}`,
              meta: `${branchOf.get(m.branch_id)?.name ?? "Branch"} · opened ${formatDateTime(m.created_at)}${m.membership_no ? ` · ${m.membership_no}` : ""}`,
              aside: <Badge tone={MEMBER_STATUSES[m.status].tone}>{MEMBER_STATUSES[m.status].label}</Badge>,
            }))}
          />
        </Card>
      )}

      <ProcessSteps title="How a member file moves through Operations" note="Each step is done by a different person" steps={STEPS} />
    </div>
  );
}
