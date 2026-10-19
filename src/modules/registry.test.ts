import { describe, expect, it } from "vitest";
import { PermissionSet } from "@/lib/auth/permissions";
import { modules, visibleModules } from "./registry";

const grant = (permission_code: string) => ({ permission_code, branch_id: null, region_id: null });

describe("visibleModules", () => {
  it("shows only modules the staff member may open", () => {
    const visible = visibleModules(new PermissionSet([grant("module.administration")]));
    expect(visible.map((m) => m.department)).toEqual(["administration"]);
  });

  it("hides nav links that need a permission the staff member lacks", () => {
    const visible = visibleModules(new PermissionSet([grant("module.internal_audit")]));
    expect(visible[0].nav.map((n) => n.label)).toEqual(["Dashboard", "Exceptions", "Customer register", "Branch reports"]);
  });

  it("gives every module a unique department, path and permission", () => {
    for (const key of ["department", "basePath", "permission"] as const) {
      expect(new Set(modules.map((m) => m[key])).size).toBe(modules.length);
    }
  });
});
