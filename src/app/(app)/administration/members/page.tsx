import Link from "next/link";
import { Badge, ButtonLink, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES, type MemberStatus } from "@/modules/administration/constants";
import { administrationModule } from "@/modules/administration/module";
import { fullName, listBranches, type Member } from "@/modules/administration/queries";

const PAGE_SIZE = 50;

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const staff = await requireModule(administrationModule);
  const { status, q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("members")
    .select("id, branch_id, membership_no, status, title, first_name, middle_name, last_name, phone, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (status && status in MEMBER_STATUSES) query = query.eq("status", status);
  const search = q?.trim().replace(/[%,()]/g, "");
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,membership_no.ilike.%${search}%,phone.ilike.%${search}%,nin.eq.${search}`,
    );
  }
  const [{ data, error }, branches] = await Promise.all([query, listBranches()]);
  if (error) throw error;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const members = data as Member[];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Members"
        actions={staff.permissions.has("members.manage") && <ButtonLink href="/administration/members/new">New member</ButtonLink>}
      />
      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <div className="min-w-56 flex-1">
          <Input name="q" defaultValue={q} placeholder="Search name, phone, membership no. or NIN" aria-label="Search" />
        </div>
        <div className="w-48">
          <Select name="status" defaultValue={status ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            {(Object.keys(MEMBER_STATUSES) as MemberStatus[]).map((s) => (
              <option key={s} value={s}>
                {MEMBER_STATUSES[s].label}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {members.length === 0 ? (
          <EmptyState>No members match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Membership no.</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <Link href={`/administration/members/${m.id}`} className="font-medium hover:underline">
                      {fullName(m)}
                    </Link>
                    <div className="text-xs text-zinc-500">{m.phone}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{m.membership_no ?? "—"}</td>
                  <td className="px-4 py-2">{branchName.get(m.branch_id)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={MEMBER_STATUSES[m.status].tone}>{MEMBER_STATUSES[m.status].label}</Badge>
                  </td>
                  <td className="px-4 py-2">{formatDate(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {members.length === PAGE_SIZE && <p className="mt-2 text-xs text-zinc-500">Showing the latest {PAGE_SIZE}. Search to narrow down.</p>}
    </div>
  );
}
