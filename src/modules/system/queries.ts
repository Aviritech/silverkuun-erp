import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";

export type Role = { code: string; name: string; department_code: string; description: string };

export type StaffGrant = { id: string; role_code: string; branch_id: string | null; region_id: string | null; granted_at: string };

export type StaffAccount = {
  id: string;
  full_name: string;
  email: string;
  department_code: string;
  home_branch_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  staff_roles: StaffGrant[];
};

// staff_roles points at staff twice (holder and granted_by), so name the link to embed by.
const STAFF_COLUMNS =
  "id, full_name, email, department_code, home_branch_id, is_active, must_change_password, created_at, staff_roles!staff_roles_staff_id_fkey(id, role_code, branch_id, region_id, granted_at)";

export async function listStaff(): Promise<StaffAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("staff").select(STAFF_COLUMNS).order("full_name");
  if (error) throw dbFailure(error);
  return data as StaffAccount[];
}

export async function getStaff(id: string): Promise<StaffAccount | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("staff").select(STAFF_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  return data as StaffAccount | null;
}

export async function listRoles(): Promise<Role[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("roles").select("code, name, department_code, description").order("name");
  if (error) throw dbFailure(error);
  return data;
}

export async function listAllDepartments() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("departments").select("code, name, is_active").order("name");
  if (error) throw dbFailure(error);
  return data as { code: string; name: string; is_active: boolean }[];
}

/** "Branch Manager (Lagos)", "Internal Auditor (whole organisation)". */
export function scopeLabel(grant: Pick<StaffGrant, "branch_id" | "region_id">, branchName: Map<string, string>, regionName: Map<string, string>) {
  if (grant.branch_id) return branchName.get(grant.branch_id) ?? "a branch";
  if (grant.region_id) return `${regionName.get(grant.region_id) ?? "a region"} region`;
  return "whole organisation";
}
