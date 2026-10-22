import type { PermissionSet } from "@/lib/auth/permissions";
import { accountsModule } from "./accounts/module";
import { administrationModule } from "./administration/module";
import { creditModule } from "./credit/module";
import { hrModule } from "./hr/module";
import { internalAuditModule } from "./internal-audit/module";
import { systemModule } from "./system/module";
import type { DepartmentModule } from "./types";

/** Every department module. Add new departments here. */
export const modules: readonly DepartmentModule[] = [
  administrationModule,
  accountsModule,
  creditModule,
  hrModule,
  internalAuditModule,
  systemModule,
];

function holdsAny(perms: PermissionSet, permission: string | readonly string[] | undefined): boolean {
  if (!permission) return true;
  return typeof permission === "string" ? perms.has(permission) : permission.some((p) => perms.has(p));
}

/** The modules a staff member can open, with nav links they are not allowed to use removed. */
export function visibleModules(perms: PermissionSet, all: readonly DepartmentModule[] = modules): DepartmentModule[] {
  return all
    .filter((m) => perms.has(m.permission))
    .map((m) => ({ ...m, nav: m.nav.filter((item) => holdsAny(perms, item.permission)) }));
}
