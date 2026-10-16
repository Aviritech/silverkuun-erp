import type { PermissionSet } from "@/lib/auth/permissions";
import { administrationModule } from "./administration/module";
import { internalAuditModule } from "./internal-audit/module";
import type { DepartmentModule } from "./types";

/** Every department module. Add new departments here. */
export const modules: readonly DepartmentModule[] = [administrationModule, internalAuditModule];

/** The modules a staff member can open, with nav links they are not allowed to use removed. */
export function visibleModules(perms: PermissionSet, all: readonly DepartmentModule[] = modules): DepartmentModule[] {
  return all
    .filter((m) => perms.has(m.permission))
    .map((m) => ({ ...m, nav: m.nav.filter((item) => !item.permission || perms.has(item.permission)) }));
}
