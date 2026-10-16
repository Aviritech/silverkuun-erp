import { requireModule, requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { internalAuditModule } from "@/modules/internal-audit/module";

const PAGE_SIZE = 100;

export default async function AuditTrailPage() {
  await requireModule(internalAuditModule);
  await requirePermission("audit.trail.read");

  const supabase = await createClient();
  const { data: entries, error } = await supabase
    .from("audit_log")
    .select("id, occurred_at, actor_id, table_name, record_id, action, changed_fields")
    .order("occurred_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw error;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Audit trail</h1>
      <p className="mt-1 text-sm text-zinc-600">The latest {PAGE_SIZE} changes you are allowed to see. Entries cannot be edited or deleted.</p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Record</th>
              <th className="px-4 py-2 font-medium">Fields changed</th>
              <th className="px-4 py-2 font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-zinc-100 last:border-0">
                <td className="whitespace-nowrap px-4 py-2">{new Date(e.occurred_at).toLocaleString("en-GB")}</td>
                <td className="px-4 py-2">{e.action}</td>
                <td className="px-4 py-2 font-mono text-xs">
                  {e.table_name.replace("public.", "")} {e.record_id}
                </td>
                <td className="px-4 py-2">{e.changed_fields?.join(", ") ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{e.actor_id ?? "system"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
