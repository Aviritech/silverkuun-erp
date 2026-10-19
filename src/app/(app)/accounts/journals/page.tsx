import Link from "next/link";
import { Badge, ButtonLink, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { accountsModule } from "@/modules/accounts/module";

const PAGE_SIZE = 100;
const SOURCES = { manual: "Manual", transaction: "Receipt or payment", reversal: "Reversal" } as const;

export default async function JournalsPage({ searchParams }: { searchParams: Promise<{ status?: string; source?: string }> }) {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const { status, source } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("journal_entries")
    .select("id, entry_no, entry_date, description, source, status, branch_id, reversed_by_entry_id, journal_lines(debit)")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (status === "draft" || status === "posted") query = query.eq("status", status);
  if (source && source in SOURCES) query = query.eq("source", source);
  const [{ data, error }, org] = await Promise.all([query, listOrg()]);
  if (error) throw dbFailure(error);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  type E = {
    id: string; entry_no: string; entry_date: string; description: string; source: keyof typeof SOURCES; status: "draft" | "posted";
    branch_id: string; reversed_by_entry_id: string | null; journal_lines: { debit: string }[];
  };
  const list = data as E[];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Journals"
        description="Every ledger entry. Receipts and payments post their own journals; manual journals cover accruals, depreciation and corrections."
        actions={staff.permissions.has("accounts.journals.prepare") && <ButtonLink href="/accounts/journals/new">New manual journal</ButtonLink>}
      />
      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <div className="w-44">
          <Select name="status" defaultValue={status ?? ""} aria-label="Status">
            <option value="">Drafts and posted</option>
            <option value="draft">Drafts to post</option>
            <option value="posted">Posted</option>
          </Select>
        </div>
        <div className="w-52">
          <Select name="source" defaultValue={source ?? ""} aria-label="Source">
            <option value="">All sources</option>
            {Object.entries(SOURCES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {list.length === 0 ? (
          <EmptyState>No journals match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Entry</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/accounts/journals/${e.id}`} className="hover:underline">
                      {e.entry_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{formatDate(e.entry_date)}</td>
                  <td className="px-4 py-2">{e.description}</td>
                  <td className="px-4 py-2">{branchName.get(e.branch_id)}</td>
                  <td className="px-4 py-2">{SOURCES[e.source]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {e.journal_lines.reduce((s, l) => s + Number(l.debit), 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2">
                    {e.status === "draft" ? (
                      <Badge tone="amber">Draft</Badge>
                    ) : e.reversed_by_entry_id ? (
                      <Badge tone="gray">Reversed</Badge>
                    ) : (
                      <Badge tone="green">Posted</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
