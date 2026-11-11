import Link from "next/link";
import { AttentionPanel, StatCard, StatGrid, firstName, greeting, workspaceEyebrow } from "@/components/dashboard";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { systemModule } from "@/modules/system/module";
import { listStaff } from "@/modules/system/queries";

export default async function SystemOverviewPage() {
  const me = await requireModule(systemModule);
  const canRead = me.permissions.has("staff.read");
  const [staff, { branches, regions }] = await Promise.all([canRead ? listStaff() : Promise.resolve([]), listOrg()]);
  const active = staff.filter((s) => s.is_active);
  const noAccess = active.filter((s) => s.staff_roles.length === 0);
  const temporary = active.filter((s) => s.must_change_password);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow={workspaceEyebrow("System Administration")}
        title={`${greeting()}, ${firstName(me.fullName)}`}
        description="Who can sign in, what they can do, and how the organisation is set up."
        actions={me.permissions.has("staff.manage") && <ButtonLink href="/system/staff/new">New login</ButtonLink>}
      />
      <StatGrid>
        <StatCard label="Active logins" icon="key" value={active.length} href="/system/staff" hint={`${staff.length - active.length} switched off`} />
        <StatCard label="Waiting for a role" icon="users" tone={noAccess.length ? "warn" : "neutral"} value={noAccess.length} href="/system/staff" hint="Can sign in but have no access yet" />
        <StatCard label="Branches" icon="bank" value={branches.length} href="/system/organisation" />
        <StatCard label="Regions" icon="map" value={regions.length} href="/system/organisation" />
      </StatGrid>

      <AttentionPanel
        count={noAccess.length}
        title={noAccess.length ? "People waiting for access" : "Everyone has a role"}
        href="/system/staff"
        cta="Open staff access"
      >
        {noAccess.length ? "Give each of them the role and branch they work in. HR creates the login; you decide what it can do." : "New logins from HR appear here until they are given a role."}
      </AttentionPanel>

      <Card title="Waiting for access">
        <p className="mb-3 text-sm text-zinc-600">
          These people can sign in but have no role yet, usually because HR has just created their login.
        </p>
        {noAccess.length === 0 ? (
          <EmptyState>Everyone who can sign in has a role.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {noAccess.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/system/staff/${s.id}`} className="font-medium hover:underline">
                  {s.full_name}
                </Link>
                <span className="text-zinc-500">{s.email}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {temporary.length > 0 && (
        <Card title="Still on a temporary password">
          <ul className="divide-y divide-zinc-100 text-sm">
            {temporary.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/system/staff/${s.id}`} className="font-medium hover:underline">
                  {s.full_name}
                </Link>
                <Badge tone="amber">Hasn&apos;t signed in yet</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
