import Link from "next/link";
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
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="System Administration"
        description="Who can sign in, what they can do, and how the organisation is set up."
        actions={me.permissions.has("staff.manage") && <ButtonLink href="/system/staff/new">New login</ButtonLink>}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Active logins", active.length, "/system/staff"],
          ["Switched off", staff.length - active.length, "/system/staff?show=inactive"],
          ["Branches", branches.length, "/system/organisation"],
          ["Regions", regions.length, "/system/organisation"],
        ].map(([label, value, href]) => (
          <Link
            key={label}
            href={href as string}
            className="rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-silver-300 hover:shadow-sm"
          >
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
          </Link>
        ))}
      </div>

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
