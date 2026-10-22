import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DepartmentModule } from "@/modules/types";
import { PermissionSet, type PermissionGrant } from "./permissions";
import { dbFailure } from "@/lib/db-errors";

export type CurrentStaff = {
  id: string;
  fullName: string;
  email: string;
  departmentCode: string;
  permissions: PermissionSet;
};

/** The signed-in staff member, loaded once per request. Signed-out visitors go to the login page. */
export const getCurrentStaff = cache(async (): Promise<CurrentStaff> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: staff }, { data: grants, error }] = await Promise.all([
    supabase
      .from("staff")
      .select("id, full_name, email, department_code, is_active, must_change_password")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.rpc("my_permissions"),
  ]);
  if (error) throw dbFailure(error);

  // An auth account with no active staff record cannot use the system.
  if (!staff || !staff.is_active) redirect("/login?error=no-access");
  // A temporary password from HR or a System Administrator has to be replaced before anything else.
  if (staff.must_change_password) redirect("/account/password");

  return {
    id: staff.id,
    fullName: staff.full_name,
    email: staff.email,
    departmentCode: staff.department_code,
    permissions: new PermissionSet((grants ?? []) as PermissionGrant[]),
  };
});

/** Use at the top of every module page. Returns 404 rather than revealing the module exists. */
export async function requireModule(module: DepartmentModule): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff.permissions.has(module.permission)) notFound();
  return staff;
}

export async function requirePermission(permission: string): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff.permissions.has(permission)) notFound();
  return staff;
}
