"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth/session";
import { temporaryPassword } from "@/lib/auth/temporary-password";
import { friendlyDbError } from "@/lib/db-errors";
import { authAdmin, setLoginBlocked } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "./constants";
import { hrModule } from "./module";
import {
  confirmSchema,
  contractEndSchema,
  contractSchema,
  dependentSchema,
  documentSchema,
  editEmployeeSchema,
  exitSchema,
  jobChangeSchema,
  jobTitleSchema,
  newEmployeeSchema,
  qualificationSchema,
  reinstateSchema,
} from "./schemas";

const PERSONAL_FIELDS = [
  "title",
  "first_name",
  "middle_name",
  "last_name",
  "date_of_birth",
  "gender",
  "marital_status",
  "phone",
  "personal_email",
  "work_email",
  "address",
  "state_of_origin",
  "nationality",
  "nin",
  "id_type",
  "id_number",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "bank_name",
  "bank_account_number",
  "pension_administrator",
  "pension_pin",
  "tax_id",
  "annual_rent",
  // Checkboxes: "on" when ticked, missing (so "") when not; personalSchema turns them into true or false.
  "pension_applies",
  "nhf_applies",
  "employment_type",
  "hire_date",
  "probation_end_date",
] as const;

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

function employeePath(employeeId: string) {
  return `/hr/employees/${employeeId}`;
}

function done(employeeId: string, message?: string): ActionState {
  revalidatePath(employeePath(employeeId));
  return { ok: true, message };
}

export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = newEmployeeSchema.safeParse({
    ...formObject(formData, [...PERSONAL_FIELDS, "branch_id", "department_code", "job_title_id", "employee_no"]),
    status: formData.get("status") || undefined,
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").insert(parsed.data).select("id").single();
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/hr", "layout");
  redirect(employeePath(data.id));
}

export async function updateEmployee(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = editEmployeeSchema.safeParse(formObject(formData, PERSONAL_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").update(parsed.data).eq("id", employeeId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't edit this employee." };

  revalidatePath(employeePath(employeeId));
  redirect(employeePath(employeeId));
}

export async function confirmEmployee(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = confirmSchema.safeParse(formObject(formData, ["confirmed_on"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_employee", { p_employee_id: employeeId, p_confirmed_on: parsed.data.confirmed_on });
  if (error) return { error: friendlyDbError(error) };
  return done(employeeId);
}

export async function changeJob(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = jobChangeSchema.safeParse(
    formObject(formData, ["event", "branch_id", "department_code", "job_title_id", "effective_date", "reason"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_employee_job", {
    p_employee_id: employeeId,
    p_event: parsed.data.event,
    p_branch_id: parsed.data.branch_id,
    p_department_code: parsed.data.department_code,
    p_job_title_id: parsed.data.job_title_id,
    p_effective_date: parsed.data.effective_date,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr", "layout");
  return { ok: true };
}

export async function recordExit(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = exitSchema.safeParse(formObject(formData, ["kind", "exit_date", "reason"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("record_employee_exit", {
      p_employee_id: employeeId,
      p_kind: parsed.data.kind,
      p_exit_date: parsed.data.exit_date,
      p_reason: parsed.data.reason,
    })
    .single<{ staff_id: string | null }>();
  if (error) return { error: friendlyDbError(error) };

  // The database has already switched the account off; also stop any open session from refreshing.
  if (data.staff_id) {
    const blockError = await setLoginBlocked(data.staff_id, true);
    if (blockError) {
      console.error("Couldn't block sign-in after an exit", { employeeId, blockError });
      return done(employeeId, "Exit recorded and ERP access removed. Their sign-in couldn't be blocked; tell the system administrator.");
    }
  }
  return done(employeeId);
}

export async function reinstateEmployee(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = reinstateSchema.safeParse(formObject(formData, ["reason"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("reinstate_employee", { p_employee_id: employeeId, p_reason: parsed.data.reason })
    .single<{ staff_id: string | null }>();
  if (error) return { error: friendlyDbError(error) };

  if (data.staff_id) {
    const unblockError = await setLoginBlocked(data.staff_id, false);
    if (unblockError) {
      console.error("Couldn't unblock sign-in after reinstating", { employeeId, unblockError });
      return done(employeeId, "Reinstated, but their sign-in is still blocked; tell the system administrator.");
    }
  }
  return done(employeeId);
}

/**
 * Gives the employee an ERP login with their work email and a temporary password, or links the staff account that
 * already uses that email. The new login has no roles: a System Administrator grants access.
 */
export async function createLogin(employeeId: string): Promise<ActionState> {
  const staff = await requireModule(hrModule);
  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, branch_id, work_email, staff_id, status, branches(id, region_id)")
    .eq("id", employeeId)
    .maybeSingle<{ id: string; work_email: string | null; staff_id: string | null; status: string; branches: { id: string; region_id: string } }>();
  if (!employee || !staff.permissions.hasForBranch("hr.manage", employee.branches)) return { error: "Employee not found." };
  if (employee.staff_id) return { error: "This employee already has an ERP login." };
  if (!employee.work_email) return { error: "Add a work email first; it is what the employee signs in with." };
  if (!["probation", "active"].includes(employee.status)) return { error: "Only current employees can have an ERP login." };

  const password = temporaryPassword();
  let createdUserId: string | undefined;
  try {
    const created = await authAdmin().createUser({ email: employee.work_email, password, email_confirm: true });
    const exists = created.error?.code === "email_exists" || /already been registered/i.test(created.error?.message ?? "");
    if (created.error && !exists) return { error: created.error.message };
    createdUserId = created.data.user?.id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const { data: isNewStaff, error } = await supabase.rpc("link_employee_login", { p_employee_id: employeeId });
  if (error) {
    // Don't leave behind a login nobody can use.
    if (createdUserId) await authAdmin().deleteUser(createdUserId);
    return { error: friendlyDbError(error) };
  }

  revalidatePath(employeePath(employeeId));
  if (!isNewStaff) {
    return { ok: true, message: "Linked to the staff account that already uses this email. Their password hasn't changed." };
  }
  if (!createdUserId) {
    // The email had a login but no staff account, so nobody knows its password: give it the temporary one.
    const { data: linked } = await supabase.from("employees").select("staff_id").eq("id", employeeId).single();
    const reset = linked?.staff_id ? await authAdmin().updateUserById(linked.staff_id, { password }) : undefined;
    if (!reset || reset.error) return { error: "The login is linked, but its password couldn't be set. Ask the system administrator to reset it." };
  }
  return {
    ok: true,
    message: `Login created for ${employee.work_email}. Give them this temporary password; they'll choose their own when they first sign in. A System Administrator still has to give them access to departments.`,
    secret: password,
  };
}

export async function uploadDocument(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = documentSchema.safeParse({ document_type: formData.get("document_type") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Choose a file to upload" } };
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) return { fieldErrors: { file: "Upload a PDF, JPEG or PNG" } };
  if (file.size > MAX_UPLOAD_BYTES) return { fieldErrors: { file: "Files can be at most 10 MB" } };
  if (parsed.data.document_type === "passport_photo" && !file.type.startsWith("image/")) {
    return { fieldErrors: { file: "Upload the photo as a JPEG or PNG" } };
  }

  const supabase = await createClient();
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-100);
  const storagePath = `${employeeId}/${randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from("hr-documents").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (upload.error) return { error: friendlyDbError({ message: upload.error.message }) };

  const { error } = await supabase.from("employee_documents").insert({
    employee_id: employeeId,
    document_type: parsed.data.document_type,
    file_name: file.name.slice(0, 200),
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
  });
  if (error) return { error: friendlyDbError(error) };
  return done(employeeId);
}

export async function removeDocument(employeeId: string, documentId: string): Promise<ActionState> {
  await requireModule(hrModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_documents").delete().eq("id", documentId).eq("employee_id", employeeId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't remove this document." };
  return done(employeeId);
}

export async function addContract(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = contractSchema.safeParse(formObject(formData, ["contract_type", "start_date", "end_date", "notes"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("employee_contracts").insert({ ...parsed.data, employee_id: employeeId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr", "layout");
  return { ok: true };
}

export async function changeContractEnd(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = contractEndSchema.safeParse(formObject(formData, ["contract_id", "end_date", "notes"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { contract_id, ...change } = parsed.data;
  const { data, error } = await supabase
    .from("employee_contracts")
    .update(change)
    .eq("id", contract_id)
    .eq("employee_id", employeeId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change this contract." };
  revalidatePath("/hr", "layout");
  return { ok: true };
}

export async function addDependent(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = dependentSchema.safeParse(formObject(formData, ["full_name", "relationship", "date_of_birth"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("employee_dependents").insert({ ...parsed.data, employee_id: employeeId });
  if (error) return { error: friendlyDbError(error) };
  return done(employeeId);
}

export async function removeDependent(employeeId: string, dependentId: string): Promise<ActionState> {
  await requireModule(hrModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_dependents").delete().eq("id", dependentId).eq("employee_id", employeeId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't remove this dependent." };
  return done(employeeId);
}

export async function addQualification(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = qualificationSchema.safeParse(formObject(formData, ["kind", "qualification", "course", "institution", "year_obtained", "expires_on"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("employee_qualifications").insert({ ...parsed.data, employee_id: employeeId });
  if (error) return { error: friendlyDbError(error) };
  return done(employeeId);
}

export async function removeQualification(employeeId: string, qualificationId: string): Promise<ActionState> {
  await requireModule(hrModule);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_qualifications")
    .delete()
    .eq("id", qualificationId)
    .eq("employee_id", employeeId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't remove this qualification." };
  return done(employeeId);
}

export async function addJobTitle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = jobTitleSchema.safeParse(formObject(formData, ["name"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("job_titles").insert(parsed.data);
  if (error) return { error: error.code === "23505" ? "That job title is already on the list." : friendlyDbError(error) };
  revalidatePath("/hr/job-titles");
  return { ok: true };
}

export async function setJobTitleActive(jobTitleId: string, isActive: boolean): Promise<ActionState> {
  await requireModule(hrModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_titles").update({ is_active: isActive }).eq("id", jobTitleId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change the job titles." };
  revalidatePath("/hr/job-titles");
  return { ok: true };
}
