import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { AUDITED_TABLES, recordHref } from "@/modules/internal-audit/constants";
import { internalAuditModule } from "@/modules/internal-audit/module";

const ACTIONS: Record<string, string> = { INSERT: "Created", UPDATE: "Changed", DELETE: "Deleted" };
const HIDDEN_FIELDS = new Set(["updated_at"]);

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Everything the audit trail holds about one record and the records hanging off it (documents, plans, lines, evidence). */
export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(internalAuditModule);
  await requirePermission("audit.trail.read");
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, occurred_at, actor_id, table_name, record_id, action, changed_fields, old_data, new_data")
    .or(
      [
        `record_id.eq.${id}`,
        `new_data->>member_id.eq.${id}`,
        `old_data->>member_id.eq.${id}`,
        `new_data->>transaction_id.eq.${id}`,
        `new_data->>entry_id.eq.${id}`,
        `new_data->>contribution_id.eq.${id}`,
      ].join(","),
    )
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1000);
  if (error) throw dbFailure(error);

  const actorIds = [...new Set(data.map((e) => e.actor_id).filter(Boolean))];
  const { data: actors } = actorIds.length ? await supabase.rpc("staff_display_names", { p_ids: actorIds }) : { data: [] };
  const actorName = new Map(((actors ?? []) as { id: string; full_name: string }[]).map((a) => [a.id, a.full_name]));
  const own = data.find((e) => e.record_id === id);
  const table = own?.table_name.replace("public.", "");
  const open = table ? recordHref(table, id) : undefined;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Record history"
        description={
          <>
            {table ? (AUDITED_TABLES[table] ?? table) : "Record"} <span className="font-mono text-xs">{id}</span>
            {open && !open.startsWith("/internal-audit/trace") && (
              <>
                {" · "}
                <Link href={open} className="underline">
                  Open the record
                </Link>
              </>
            )}
          </>
        }
      />
      {data.length === 0 ? (
        <EmptyState>No audit entries for this record, or it belongs to a branch you don&apos;t cover.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {data.map((e) => {
            const t = e.table_name.replace("public.", "");
            const fields =
              e.action === "UPDATE"
                ? (e.changed_fields ?? []).filter((f: string) => !HIDDEN_FIELDS.has(f))
                : [];
            return (
              <li key={e.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <p>
                      <span className="font-medium">{ACTIONS[e.action] ?? e.action}</span> {AUDITED_TABLES[t] ?? t}
                      {e.record_id !== id && <span className="ml-1 font-mono text-xs text-zinc-500">{e.record_id}</span>}
                    </p>
                    <p className="text-zinc-600">
                      {e.actor_id ? (actorName.get(e.actor_id) ?? e.actor_id) : "System"} · {formatDateTime(e.occurred_at)}
                    </p>
                  </div>
                  {fields.length > 0 && (
                    <table className="mt-2 w-full text-left text-xs">
                      <thead className="text-zinc-500">
                        <tr>
                          <th className="py-1 pr-3 font-medium">Field</th>
                          <th className="py-1 pr-3 font-medium">Before</th>
                          <th className="py-1 font-medium">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f: string) => (
                          <tr key={f} className="border-t border-zinc-100 align-top">
                            <td className="py-1 pr-3 font-mono">{f}</td>
                            <td className="break-all py-1 pr-3 text-red-800">{show(e.old_data?.[f])}</td>
                            <td className="break-all py-1 text-emerald-800">{show(e.new_data?.[f])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
