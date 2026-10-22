import Link from "next/link";
import { Badge, ButtonLink, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { systemModule } from "@/modules/system/module";
import { listRoles, listStaff, scopeLabel } from "@/modules/system/queries";

export default async function StaffAccessPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  await requireModule(systemModule);
  const me = await requirePermission("staff.read");
  const { q, show = "active" } = await searchParams;
  const [staff, roles, { branches, regions }] = await Promise.all([listStaff(), listRoles(), listOrg()]);
  const roleName = new Map(roles.map((r) => [r.code, r.name]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const regionName = new Map(regions.map((r) => [r.id, r.name]));

  const search = q?.trim().toLowerCase();
  const rows = staff
    .filter((s) => (show === "inactive" ? !s.is_active : show === "all" ? true : s.is_active))
    .filter((s) => !search || s.full_name.toLowerCase().includes(search) || s.email.toLowerCase().includes(search));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Staff access"
        description="Everyone who can sign in, and the roles that decide what they see. Staff on the payroll get their login from HR."
        actions={me.permissions.has("staff.manage") && <ButtonLink href="/system/staff/new">New login</ButtonLink>}
      />
      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <div className="min-w-56 flex-1">
          <Input name="q" defaultValue={q} placeholder="Search name or email" aria-label="Search" />
        </div>
        <div className="w-40">
          <Select name="show" defaultValue={show} aria-label="Show">
            <option value="active">Active</option>
            <option value="inactive">Switched off</option>
            <option value="all">Everyone</option>
          </Select>
        </div>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {rows.length === 0 ? (
          <EmptyState>Nobody matches.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Roles</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <Link href={`/system/staff/${s.id}`} className="font-medium hover:underline">
                      {s.full_name}
                    </Link>
                    <div className="text-xs text-zinc-500">{s.email}</div>
                  </td>
                  <td className="px-4 py-2">
                    {s.staff_roles.length === 0 ? (
                      <span className="text-amber-700">No access yet</span>
                    ) : (
                      <ul>
                        {s.staff_roles.map((g) => (
                          <li key={g.id}>
                            {roleName.get(g.role_code) ?? g.role_code}{" "}
                            <span className="text-zinc-500">({scopeLabel(g, branchName, regionName)})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {s.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Switched off</Badge>}
                    {s.is_active && s.must_change_password && (
                      <span className="ml-1">
                        <Badge tone="amber">Temporary password</Badge>
                      </span>
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
