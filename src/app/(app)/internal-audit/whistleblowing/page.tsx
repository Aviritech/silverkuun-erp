import Link from "next/link";
import { Badge, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { staffNameLookup } from "@/modules/accounts/queries";
import { internalAuditModule } from "@/modules/internal-audit/module";
import {
  CASE_STATUSES,
  SPEAK_UP_CATEGORIES,
  type CaseStatus,
  type SpeakUpCategory,
} from "@/modules/internal-audit/whistleblowing/constants";

const STATUS_FILTERS: Record<string, { label: string; statuses: CaseStatus[] }> = {
  open: { label: "Open cases", statuses: ["received", "investigating"] },
  received: { label: "Not yet picked up", statuses: ["received"] },
  investigating: { label: "Investigating", statuses: ["investigating"] },
  closed: { label: "Closed", statuses: ["resolved", "dismissed"] },
  all: { label: "All cases", statuses: ["received", "investigating", "resolved", "dismissed"] },
};

type ReportRow = {
  id: string;
  reference: string;
  received_on: string;
  category: SpeakUpCategory;
  title: string;
  status: CaseStatus;
  assigned_to: string | null;
};

export default async function WhistleblowingPage({ searchParams }: { searchParams: Promise<{ status?: string; category?: string }> }) {
  await requireModule(internalAuditModule);
  await requirePermission("whistleblowing.manage");
  const { status = "open", category = "" } = await searchParams;
  const filter = STATUS_FILTERS[status] ?? STATUS_FILTERS.open;

  const supabase = await createClient();
  let query = supabase
    .from("whistleblowing_reports")
    .select("id, reference, received_on, category, title, status, assigned_to")
    .in("status", filter.statuses)
    .order("received_on", { ascending: false })
    .order("reference")
    .limit(500);
  if (category in SPEAK_UP_CATEGORIES) query = query.eq("category", category);
  const { data, error } = await query;
  if (error) throw dbFailure(error);
  const reports = data as ReportRow[];
  const staffName = await staffNameLookup(reports.map((r) => r.assigned_to));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Whistleblowing"
        description="Concerns raised through Speak up. Anonymous reports carry nothing about who sent them; talk to the reporter through the case's messages."
      />
      <form className="mb-4 flex flex-wrap gap-3">
        <div className="w-48">
          <Select name="status" defaultValue={status in STATUS_FILTERS ? status : "open"} aria-label="Status">
            {Object.entries(STATUS_FILTERS).map(([value, f]) => (
              <option key={value} value={value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <Select name="category" defaultValue={category} aria-label="Category">
            <option value="">All categories</option>
            {Object.entries(SPEAK_UP_CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {reports.length === 0 ? (
          <EmptyState>No cases match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 font-medium">Received</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <Link href={`/internal-audit/whistleblowing/${r.id}`} className="font-mono text-xs font-medium hover:underline">
                      {r.reference}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">{formatDate(r.received_on)}</td>
                  <td className="px-4 py-2">{SPEAK_UP_CATEGORIES[r.category]}</td>
                  <td className="px-4 py-2">
                    <Link href={`/internal-audit/whistleblowing/${r.id}`} className="hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={CASE_STATUSES[r.status].tone}>{CASE_STATUSES[r.status].label}</Badge>
                  </td>
                  <td className="px-4 py-2">{r.assigned_to ? staffName(r.assigned_to) : <span className="text-zinc-500">Nobody yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
