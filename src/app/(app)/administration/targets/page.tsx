import { DataTable } from "@/components/data-table";
import { Card, Input, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { saveBranchTarget } from "@/modules/administration/actions";
import { TargetForm } from "@/modules/administration/components/forms";
import { administrationModule } from "@/modules/administration/module";
import { branchesWith } from "@/modules/administration/queries";
import { targetAchievement } from "@/modules/administration/targets";

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireModule(administrationModule);
  await requirePermission("members.read");
  const { month: requested } = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? "") ? requested! : new Date().toISOString().slice(0, 7);

  const supabase = await createClient();
  const [rows, branches, settable] = await Promise.all([
    targetAchievement(supabase, month),
    branchesWith(staff.permissions, "members.read"),
    branchesWith(staff.permissions, "targets.manage"),
  ]);
  const visible = new Set(branches.map((b) => b.id));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Branch targets"
        description="Monthly targets for new members and collections, against what each branch achieved. Collections are net of reversals."
      />
      <form className="flex items-end gap-3" role="search">
        <label className="text-sm">
          Month
          <Input type="month" name="month" defaultValue={month} />
        </label>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Show
        </button>
      </form>
      <Card title={`Targets for ${month}`} actions={settable.length > 0 && <TargetForm action={saveBranchTarget} branches={settable} month={month} />}>
        <div className="overflow-x-auto">
          <DataTable
            columns={[
              { key: "branch_name", label: "Branch" },
              { key: "target_registrations", label: "New members target", kind: "number" },
              { key: "registrations", label: "New members", kind: "number" },
              { key: "registrations_pct", label: "Achieved" },
              { key: "target_collections", label: "Collections target", kind: "money" },
              { key: "collections", label: "Collected", kind: "money" },
              { key: "collections_pct", label: "Achieved" },
            ]}
            rows={rows.filter((r) => visible.has(r.branch_id))}
            empty="No branches to show."
          />
        </div>
        {settable.length === 0 && (
          <p className="mt-3 text-xs text-zinc-500">Targets are set by the Head of Administration.</p>
        )}
      </Card>
    </div>
  );
}
