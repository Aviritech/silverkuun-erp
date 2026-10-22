import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { addBranch, addDepartment, addRegion, setBranchActive } from "@/modules/system/actions";
import { BranchForm, DepartmentForm, RegionForm } from "@/modules/system/components/forms";
import { systemModule } from "@/modules/system/module";
import { listAllDepartments } from "@/modules/system/queries";

export default async function OrganisationPage() {
  await requireModule(systemModule);
  await requirePermission("system.manage");
  const supabase = await createClient();
  const [branches, regions, departments] = await Promise.all([
    supabase.from("branches").select("id, code, name, region_id, is_active").order("name"),
    supabase.from("regions").select("id, code, name").order("name"),
    listAllDepartments(),
  ]);
  if (branches.error) throw dbFailure(branches.error);
  if (regions.error) throw dbFailure(regions.error);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Organisation"
        description="Regions group branches. Every role is given for one branch, one region or the whole organisation."
      />

      <Card title="Regions and branches" actions={<RegionForm action={addRegion} />}>
        {regions.data.length === 0 ? (
          <EmptyState>Add a region first, then its branches.</EmptyState>
        ) : (
          <div className="space-y-5">
            {regions.data.map((r) => {
              const list = branches.data.filter((b) => b.region_id === r.id);
              return (
                <section key={r.id}>
                  <h3 className="text-sm font-semibold text-ink">
                    {r.name} <span className="font-mono text-xs font-normal text-zinc-500">{r.code}</span>
                  </h3>
                  {list.length === 0 ? (
                    <p className="py-2 text-sm text-zinc-500">No branches.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 text-sm">
                      {list.map((b) => (
                        <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                          <span className={b.is_active ? "" : "text-zinc-400"}>
                            {b.name} <span className="font-mono text-xs text-zinc-500">{b.code}</span>
                            {!b.is_active && (
                              <span className="ml-2">
                                <Badge>Closed</Badge>
                              </span>
                            )}
                          </span>
                          <ActionButton
                            action={setBranchActive.bind(null, b.id, !b.is_active)}
                            label={b.is_active ? "Close" : "Reopen"}
                            variant="secondary"
                            confirm={
                              b.is_active
                                ? `Close ${b.name}? Its records stay, but it's no longer offered for new members and staff.`
                                : undefined
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
            <BranchForm action={addBranch} regions={regions.data} />
          </div>
        )}
      </Card>

      <Card title="Departments" actions={<DepartmentForm action={addDepartment} />}>
        <p className="mb-3 text-sm text-zinc-600">
          Departments that have an ERP module (Accounts, Credit…) come with the system. Add the others staff work in, such as
          Marketing, so HR can place people there.
        </p>
        <ul className="divide-y divide-zinc-100 text-sm">
          {departments.map((d) => (
            <li key={d.code} className="flex justify-between gap-3 py-2">
              <span>{d.name}</span>
              <span className="font-mono text-xs text-zinc-500">{d.code}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
