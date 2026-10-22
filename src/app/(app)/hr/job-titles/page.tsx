import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { addJobTitle, setJobTitleActive } from "@/modules/hr/actions";
import { JobTitleForm } from "@/modules/hr/components/forms";
import { hrModule } from "@/modules/hr/module";
import { listJobTitles } from "@/modules/hr/queries";

export default async function JobTitlesPage() {
  const staff = await requireModule(hrModule);
  const canConfigure = staff.permissions.has("hr.config");
  const supabase = await createClient();
  const [titles, holders] = await Promise.all([
    listJobTitles(),
    supabase.from("employees").select("job_title_id").in("status", ["probation", "active"]),
  ]);
  if (holders.error) throw dbFailure(holders.error);
  const count = new Map<string, number>();
  for (const h of holders.data) count.set(h.job_title_id, (count.get(h.job_title_id) ?? 0) + 1);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Job titles"
        description="The titles employees can hold. Leave requests will be routed to approvers by job title, so keep each title spelt one way."
      />
      <Card title="Titles" actions={canConfigure && <JobTitleForm action={addJobTitle} />}>
        {titles.length === 0 ? (
          <EmptyState>No job titles yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {titles.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span className={t.is_active ? "" : "text-zinc-400"}>
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {count.get(t.id) ?? 0} {count.get(t.id) === 1 ? "person" : "people"}
                  </span>
                  {!t.is_active && (
                    <span className="ml-2">
                      <Badge>Retired</Badge>
                    </span>
                  )}
                </span>
                {canConfigure && (
                  <ActionButton
                    action={setJobTitleActive.bind(null, t.id, !t.is_active)}
                    label={t.is_active ? "Retire" : "Bring back"}
                    variant="secondary"
                    confirm={
                      t.is_active
                        ? `Retire "${t.name}"? People who hold it keep it, but nobody new can be given it.`
                        : undefined
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
