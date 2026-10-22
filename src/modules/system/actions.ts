"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth/session";
import { temporaryPassword } from "@/lib/auth/temporary-password";
import { friendlyDbError } from "@/lib/db-errors";
import { authAdmin, setLoginBlocked } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { branchSchema, departmentSchema, grantRoleSchema, newStaffSchema, regionSchema } from "./schemas";

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

function staffPath(staffId: string) {
  return `/system/staff/${staffId}`;
}

/**
 * A login for someone who needs the ERP but has no HR record yet, such as an external auditor. Staff on the payroll
 * should get theirs from HR, from their employee record.
 */
export async function createStaffLogin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requirePermission("staff.manage");
  const parsed = newStaffSchema.safeParse(formObject(formData, ["full_name", "email", "department_code", "home_branch_id"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const password = temporaryPassword();
  let userId: string;
  try {
    const created = await authAdmin().createUser({ email: parsed.data.email, password, email_confirm: true });
    if (created.error) {
      const exists = created.error.code === "email_exists" || /already been registered/i.test(created.error.message);
      return exists ? { fieldErrors: { email: "That email already has a login" } } : { error: created.error.message };
    }
    userId = created.data.user.id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  // Row level security checks the caller may create staff accounts.
  const supabase = await createClient();
  const { error } = await supabase.from("staff").insert({ id: userId, ...parsed.data, must_change_password: true });
  if (error) {
    await authAdmin().deleteUser(userId);
    return { error: friendlyDbError(error) };
  }

  console.info("Staff login created", { by: me.id, staffId: userId });
  revalidatePath("/system", "layout");
  return {
    ok: true,
    message: `Login created for ${parsed.data.email}. Give them this temporary password, then give them a role on their page.`,
    secret: password,
  };
}

export async function grantRole(staffId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requirePermission("staff.manage");
  const parsed = grantRoleSchema.safeParse(formObject(formData, ["role_code", "scope", "region_id", "branch_id"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  if (staffId === me.id) return { error: "Someone else has to change your own roles." };

  const supabase = await createClient();
  const { error } = await supabase.from("staff_roles").insert({ staff_id: staffId, granted_by: me.id, ...parsed.data });
  if (error) return { error: error.code === "23505" ? "They already have that role there." : friendlyDbError(error) };
  revalidatePath(staffPath(staffId));
  return { ok: true };
}

export async function revokeRole(staffId: string, grantId: string): Promise<ActionState> {
  await requirePermission("staff.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.from("staff_roles").delete().eq("id", grantId).eq("staff_id", staffId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't remove this role." };
  revalidatePath(staffPath(staffId));
  return { ok: true };
}

export async function setStaffActive(staffId: string, isActive: boolean): Promise<ActionState> {
  await requirePermission("staff.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.from("staff").update({ is_active: isActive }).eq("id", staffId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change this account." };

  const blockError = await setLoginBlocked(staffId, !isActive);
  revalidatePath(staffPath(staffId));
  if (blockError) {
    console.error("Couldn't change sign-in block", { staffId, isActive, blockError });
    return { error: `ERP access is ${isActive ? "back on" : "off"}, but sign-in couldn't be ${isActive ? "unblocked" : "blocked"}: ${blockError}` };
  }
  return { ok: true };
}

/** For someone who has forgotten their password. They must choose a new one when they next sign in. */
export async function resetPassword(staffId: string): Promise<ActionState> {
  const me = await requirePermission("staff.manage");
  if (staffId === me.id) return { error: "Change your own password from the link at the top of the page." };

  // Row level security checks the caller may manage this account before the login is touched.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .update({ must_change_password: true })
    .eq("id", staffId)
    .select("email, is_active")
    .maybeSingle();
  if (error) return { error: friendlyDbError(error) };
  if (!data) return { error: "You can't reset this password." };
  if (!data.is_active) return { error: "This account is switched off. Switch it back on first." };

  const password = temporaryPassword();
  try {
    const { error: authError } = await authAdmin().updateUserById(staffId, { password });
    if (authError) return { error: authError.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(staffPath(staffId));
  return {
    ok: true,
    message: `Password reset for ${data.email}. Give them this temporary password; they'll choose their own when they sign in.`,
    secret: password,
  };
}

export async function addRegion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("system.manage");
  const parsed = regionSchema.safeParse(formObject(formData, ["code", "name"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("regions").insert(parsed.data);
  if (error) return { error: error.code === "23505" ? "That region code is already used." : friendlyDbError(error) };
  revalidatePath("/system/organisation");
  return { ok: true };
}

export async function addBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("system.manage");
  const parsed = branchSchema.safeParse(formObject(formData, ["region_id", "code", "name"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("branches").insert(parsed.data);
  if (error) return { error: error.code === "23505" ? "That branch code is already used." : friendlyDbError(error) };
  revalidatePath("/system/organisation");
  return { ok: true };
}

export async function setBranchActive(branchId: string, isActive: boolean): Promise<ActionState> {
  await requirePermission("system.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.from("branches").update({ is_active: isActive }).eq("id", branchId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change branches." };
  revalidatePath("/system/organisation");
  return { ok: true };
}

export async function addDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("system.manage");
  const parsed = departmentSchema.safeParse(formObject(formData, ["code", "name"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("departments").insert(parsed.data);
  if (error) return { error: error.code === "23505" ? "That department code is already used." : friendlyDbError(error) };
  revalidatePath("/system/organisation");
  return { ok: true };
}
