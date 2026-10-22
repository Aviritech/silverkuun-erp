import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { SecretButton } from "@/components/secret-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { grantRole, resetPassword, revokeRole, setStaffActive } from "@/modules/system/actions";
import { GrantRoleForm } from "@/modules/system/components/forms";
import { systemModule } from "@/modules/system/module";
import { getStaff, listAllDepartments, listRoles, scopeLabel } from "@/modules/system/queries";

export default async function StaffAccountPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(systemModule);
  const me = await requirePermission("staff.read");
  const { id } = await params;
  const [account, roles, departments, { branches, regions }] = await Promise.all([getStaff(id), listRoles(), listAllDepartments(), listOrg()]);
  if (!account) notFound();

  const canManage = me.permissions.has("staff.manage");
  const isSelf = account.id === me.id;
  const roleByCode = new Map(roles.map((r) => [r.code, r]));
  const departmentName = new Map(departments.map((d) => [d.code, d.name]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const regionName = new Map(regions.map((r) => [r.id, r.name]));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={account.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {account.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Switched off</Badge>}
            {account.is_active && account.must_change_password && <Badge tone="amber">Temporary password</Badge>}
            <span>{account.email}</span>
            <span>
              · {departmentName.get(account.department_code) ?? account.department_code}
              {account.home_branch_id && `, ${branchName.get(account.home_branch_id)}`}
            </span>
          </span>
        }
      />

      <Card
        title="Roles"
        actions={
          canManage &&
          !isSelf &&
          account.is_active && (
            <GrantRoleForm
              action={grantRole.bind(null, account.id)}
              roles={roles.map((r) => ({ code: r.code, name: r.name, department: departmentName.get(r.department_code) ?? r.department_code }))}
              regions={regions}
              branches={branches}
            />
          )
        }
      >
        {account.staff_roles.length === 0 ? (
          <EmptyState>No roles yet, so they see no departments.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {account.staff_roles.map((g) => {
              const role = roleByCode.get(g.role_code);
              return (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div>
                    <span className="font-medium">{role?.name ?? g.role_code}</span>
                    <span className="ml-2 text-zinc-600">{scopeLabel(g, branchName, regionName)}</span>
                    {role?.description && <div className="text-xs text-zinc-500">{role.description}</div>}
                    <div className="text-xs text-zinc-500">Given {formatDate(g.granted_at)}</div>
                  </div>
                  {canManage && !isSelf && (
                    <ActionButton
                      action={revokeRole.bind(null, account.id, g.id)}
                      label="Remove"
                      variant="secondary"
                      confirm={`Remove the ${role?.name ?? g.role_code} role from ${account.full_name}?`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {isSelf && <p className="mt-3 text-sm text-zinc-600">Another System Administrator has to change your own roles.</p>}
      </Card>

      {canManage && !isSelf && (
        <Card title="Sign-in">
          <div className="flex flex-wrap items-start gap-6">
            {account.is_active && (
              <SecretButton
                action={resetPassword.bind(null, account.id)}
                label="Reset password"
                pendingLabel="Resetting…"
                variant="secondary"
                confirm={`Reset ${account.full_name}'s password? Their current password stops working and you'll get a temporary one to give them.`}
              />
            )}
            <ActionButton
              action={setStaffActive.bind(null, account.id, !account.is_active)}
              label={account.is_active ? "Switch off login" : "Switch login back on"}
              variant={account.is_active ? "danger" : "secondary"}
              confirm={
                account.is_active
                  ? `Switch off ${account.full_name}'s login? They're signed out and can't sign back in. For someone leaving the company, record the exit in HR instead.`
                  : undefined
              }
            />
          </div>
        </Card>
      )}
    </div>
  );
}
