import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { getCurrentStaff } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/format";
import { MEMBER_STATUSES } from "@/modules/administration/constants";
import { listMyClients, type MyClient } from "@/modules/clients/queries";

const SORTS = {
  contributions: { label: "Most contributed", by: (a: MyClient, b: MyClient) => Number(b.total_contributed) - Number(a.total_contributed) },
  month: { label: "Most this month", by: (a: MyClient, b: MyClient) => Number(b.paid_this_month) - Number(a.paid_this_month) },
  quiet: {
    label: "Longest since last payment",
    by: (a: MyClient, b: MyClient) => (a.last_paid_on ?? "0000").localeCompare(b.last_paid_on ?? "0000"),
  },
  newest: { label: "Newest", by: (a: MyClient, b: MyClient) => b.joined_on.localeCompare(a.joined_on) },
  name: { label: "Name", by: (a: MyClient, b: MyClient) => a.full_name.localeCompare(b.full_name) },
} as const;
type SortKey = keyof typeof SORTS;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Every staff member's own clients: the members they brought in, with what each has paid, so they can follow up. */
export default async function MyClientsPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  await getCurrentStaff();
  const { sort: sortParam } = await searchParams;
  const sort: SortKey = sortParam && sortParam in SORTS ? (sortParam as SortKey) : "contributions";
  const all = await listMyClients();

  const toConfirm = all.filter((c) => c.status === "with_marketer");
  const members = all.filter((c) => c.status === "approved").sort(SORTS[sort].by);
  const inProgress = all.filter((c) => c.status !== "approved" && c.status !== "with_marketer");
  const total = members.reduce((s, c) => s + Number(c.total_contributed), 0);
  const thisMonth = members.reduce((s, c) => s + Number(c.paid_this_month), 0);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="My clients"
        description="Members you brought in to Silverkuun and what each has paid in, so you can see who to follow up first."
        actions={<ButtonLink href="/clients/links">Send a sign-up link</ButtonLink>}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Members" value={String(members.length)} hint={inProgress.length ? `${inProgress.length} more being registered` : undefined} />
        <Stat label="Total contributions" value={formatMoney(total)} />
        <Stat label="Paid this month" value={formatMoney(thisMonth)} />
        <Stat label="Waiting for you to confirm" value={String(toConfirm.length)} />
      </div>

      {toConfirm.length > 0 && (
        <Card title={`Waiting for you to confirm (${toConfirm.length})`}>
          <p className="mb-3 text-xs text-zinc-500">
            You were named as the person who brought these clients in. Confirm you know them, or send the file back to the officer.
          </p>
          <ul>
            {toConfirm.map((c) => (
              <li key={c.member_id} className="flex items-center justify-between gap-4 border-b border-zinc-100 py-3 last:border-0">
                <div>
                  <p className="font-medium">{c.full_name}</p>
                  <p className="text-xs text-zinc-500">
                    {c.branch_name} · {c.source === "self_signup" ? "filled in by the client through your link" : "sent by an officer"}
                  </p>
                </div>
                <ButtonLink href={`/clients/${c.member_id}`} variant="secondary">
                  Review
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Members">
        <div className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Sort by">
          {(Object.keys(SORTS) as SortKey[]).map((key) => (
            <Link
              key={key}
              href={`/clients?sort=${key}`}
              aria-current={key === sort ? "true" : undefined}
              className={`rounded-full px-3 py-1 ring-1 ring-inset ${key === sort ? "bg-ink text-white ring-ink" : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50"}`}
            >
              {SORTS[key].label}
            </Link>
          ))}
        </div>
        {members.length === 0 ? (
          <EmptyState>
            No approved members yet. When an officer names you as the person who brought a client in, or a client fills your sign-up link,
            they appear here once approved.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Member</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 text-right font-medium">Open plans</th>
                  <th className="px-3 py-2 text-right font-medium">Total contributions</th>
                  <th className="px-3 py-2 text-right font-medium">This month</th>
                  <th className="px-3 py-2 font-medium">Last paid</th>
                </tr>
              </thead>
              <tbody>
                {members.map((c) => (
                  <tr key={c.member_id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="px-3 py-2">
                      <Link href={`/clients/${c.member_id}`} className="font-medium hover:underline">
                        {c.full_name}
                      </Link>
                      <p className="text-xs text-zinc-500">
                        {c.membership_no} · {c.phone}
                      </p>
                    </td>
                    <td className="px-3 py-2">{c.branch_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.open_plans}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(c.total_contributed)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(c.paid_this_month)}</td>
                    <td className="px-3 py-2">{c.last_paid_on ? formatDate(c.last_paid_on) : "Nothing yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-zinc-500">
              Totals include every recorded payment, net of reversals; Accounts may not have verified the newest ones yet.
            </p>
          </div>
        )}
      </Card>

      {inProgress.length > 0 && (
        <Card title={`Being registered (${inProgress.length})`}>
          <ul>
            {inProgress.map((c) => (
              <li key={c.member_id} className="flex items-center justify-between gap-4 border-b border-zinc-100 py-2 last:border-0">
                <Link href={`/clients/${c.member_id}`} className="text-sm font-medium hover:underline">
                  {c.full_name}
                </Link>
                <Badge tone={MEMBER_STATUSES[c.status].tone}>{MEMBER_STATUSES[c.status].label}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
