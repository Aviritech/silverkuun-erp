"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getCurrentStaff, requireModule } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { getMyEmployee } from "@/modules/me/queries";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "../constants";
import { hrModule } from "../module";
import {
  approvalStepSchema,
  approveSchema,
  cancelSchema,
  holidaySchema,
  leaveTypeSchema,
  reasonSchema,
  recordLeaveSchema,
  requestLeaveSchema,
} from "./schemas";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const REQUEST_FIELDS = ["leave_type_id", "start_date", "end_date", "reason", "relief_employee_id", "document_type"] as const;

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

// Everything that shows leave: the HR list and detail pages, and each person's own pages.
function revalidateLeave(requestId?: string) {
  revalidatePath("/hr/leave");
  if (requestId) revalidatePath(`/hr/leave/${requestId}`);
  revalidatePath("/me", "layout");
}

/**
 * Puts the supporting document on the employee's file and returns its id. Done before the request, because the
 * request must point at it; if the request then fails the document stays on the file, which does no harm.
 */
async function attachEvidence(
  supabase: Supabase,
  employeeId: string,
  formData: FormData,
  documentType: "medical_report" | "other",
): Promise<{ documentId: string | null } | { failure: ActionState }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { documentId: null };
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) return { failure: { fieldErrors: { file: "Upload a PDF, JPEG or PNG" } } };
  if (file.size > MAX_UPLOAD_BYTES) return { failure: { fieldErrors: { file: "Files can be at most 10 MB" } } };

  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-100);
  const storagePath = `${employeeId}/${randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from("hr-documents").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (upload.error) return { failure: { error: friendlyDbError({ message: upload.error.message }) } };

  const { data, error } = await supabase
    .from("employee_documents")
    .insert({
      employee_id: employeeId,
      document_type: documentType,
      file_name: file.name.slice(0, 200),
      storage_path: storagePath,
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select("id")
    .single();
  if (error) return { failure: { error: friendlyDbError(error) } };
  return { documentId: data.id as string };
}

/** The signed-in employee asks for leave for themselves. */
export async function requestMyLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const employee = await getMyEmployee();
  if (!employee) return { error: "Your login isn't linked to an employee record. Ask HR." };
  const parsed = requestLeaveSchema.safeParse(formObject(formData, REQUEST_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const evidence = await attachEvidence(supabase, employee.id, formData, parsed.data.document_type);
  if ("failure" in evidence) return evidence.failure;

  const { data, error } = await supabase
    .rpc("request_leave", {
      p_leave_type_id: parsed.data.leave_type_id,
      p_start: parsed.data.start_date,
      p_end: parsed.data.end_date,
      p_reason: parsed.data.reason,
      p_relief_employee_id: parsed.data.relief_employee_id,
      p_document_id: evidence.documentId,
    })
    .single<{ id: string; request_no: string; days: number; status: string }>();
  if (error) return { error: friendlyDbError(error) };

  revalidateLeave(data.id);
  return {
    ok: true,
    message:
      data.status === "approved"
        ? `Request ${data.request_no} for ${data.days} working days is approved.`
        : `Request ${data.request_no} for ${data.days} working days has been sent for approval.`,
  };
}

/** HR records leave for an employee, including leave already taken. */
export async function recordLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = recordLeaveSchema.safeParse(formObject(formData, [...REQUEST_FIELDS, "employee_id"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const evidence = await attachEvidence(supabase, parsed.data.employee_id, formData, parsed.data.document_type);
  if ("failure" in evidence) return evidence.failure;

  const { data, error } = await supabase
    .rpc("request_leave", {
      p_leave_type_id: parsed.data.leave_type_id,
      p_start: parsed.data.start_date,
      p_end: parsed.data.end_date,
      p_reason: parsed.data.reason,
      p_relief_employee_id: parsed.data.relief_employee_id,
      p_document_id: evidence.documentId,
      p_employee_id: parsed.data.employee_id,
    })
    .single<{ id: string }>();
  if (error) return { error: friendlyDbError(error) };

  revalidateLeave(data.id);
  redirect(`/hr/leave/${data.id}`);
}

/** Approves the step the signed-in staff member is acting on: relief officer, approver in the chain, or HR. */
export async function approveLeaveStep(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = approveSchema.safeParse(formObject(formData, ["comment"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_leave_step", { p_request_id: requestId, p_comment: parsed.data.comment });
  if (error) return { error: friendlyDbError(error) };
  revalidateLeave(requestId);
  return { ok: true };
}

export async function rejectLeaveStep(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = reasonSchema.safeParse(formObject(formData, ["reason"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_leave_step", { p_request_id: requestId, p_reason: parsed.data.reason });
  if (error) return { error: friendlyDbError(error) };
  revalidateLeave(requestId);
  return { ok: true };
}

/** The Head of HR approves or turns down a request outright, whatever step it has reached. */
export async function decideLeave(requestId: string, approve: boolean, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = reasonSchema.safeParse(formObject(formData, ["reason"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_leave_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidateLeave(requestId);
  return { ok: true };
}

/** HR cancels a request for the employee, with an optional note. */
export async function cancelLeave(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = cancelSchema.safeParse(formObject(formData, ["reason"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_leave_request", { p_request_id: requestId, p_reason: parsed.data.reason });
  if (error) return { error: friendlyDbError(error) };
  revalidateLeave(requestId);
  return { ok: true };
}

/** The employee withdraws their own request. */
export async function cancelMyLeave(requestId: string): Promise<ActionState> {
  await getCurrentStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_leave_request", { p_request_id: requestId, p_reason: "Withdrawn by the employee" });
  if (error) return { error: friendlyDbError(error) };
  revalidateLeave(requestId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings (row level security lets only hr.config holders write these)
// ---------------------------------------------------------------------------

const SETTINGS_PATH = "/hr/settings/leave";

function leaveTypeInput(formData: FormData) {
  return {
    ...formObject(formData, [
      "name",
      "days_per_year",
      "max_days_per_request",
      "document_after_days",
      "extra_days_after_5_years",
      "extra_days_after_10_years",
      "only_for_gender",
    ]),
    is_paid: formData.get("is_paid") === "on",
    uses_balance: formData.get("uses_balance") === "on",
    prorate: formData.get("prorate") === "on",
  };
}

function settingsError(error: { code?: string; message: string }, duplicate: string): ActionState {
  return { error: error.code === "23505" ? duplicate : friendlyDbError(error) };
}

export async function addLeaveType(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = leaveTypeSchema.safeParse(leaveTypeInput(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: last } = await supabase.from("leave_types").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const sortOrder = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;
  const { error } = await supabase.from("leave_types").insert({ ...parsed.data, sort_order: sortOrder });
  if (error) return settingsError(error, "That leave type is already on the list.");
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function updateLeaveType(leaveTypeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = leaveTypeSchema.safeParse(leaveTypeInput(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("leave_types").update(parsed.data).eq("id", leaveTypeId).select("id");
  if (error) return settingsError(error, "Another leave type already has that name.");
  if (!data?.length) return { error: "You can't change the leave types." };
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function setLeaveTypeActive(leaveTypeId: string, isActive: boolean): Promise<ActionState> {
  await requireModule(hrModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("leave_types").update({ is_active: isActive }).eq("id", leaveTypeId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change the leave types." };
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

function approvalStepInput(formData: FormData) {
  return {
    ...formObject(formData, ["name", "scope"]),
    job_title_ids: formData.getAll("job_title_ids").map(String),
    same_department: formData.get("same_department") === "on",
  };
}

export async function addApprovalStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = approvalStepSchema.safeParse(approvalStepInput(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("leave_approval_steps")
    .select("step_order")
    .order("step_order", { ascending: false })
    .limit(1);
  const stepOrder = ((last?.[0]?.step_order as number | undefined) ?? 0) + 1;
  const { error } = await supabase.from("leave_approval_steps").insert({ ...parsed.data, step_order: stepOrder });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function updateApprovalStep(stepId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = approvalStepSchema.safeParse(approvalStepInput(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("leave_approval_steps").update(parsed.data).eq("id", stepId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change the approval chain." };
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function setApprovalStepActive(stepId: string, isActive: boolean): Promise<ActionState> {
  await requireModule(hrModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("leave_approval_steps").update({ is_active: isActive }).eq("id", stepId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change the approval chain." };
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** Swaps the step with the one before it (up) or after it (down). Only new requests follow the new order. */
export async function moveApprovalStep(stepId: string, direction: "up" | "down"): Promise<ActionState> {
  await requireModule(hrModule);
  const supabase = await createClient();
  const { data: steps, error } = await supabase.from("leave_approval_steps").select("id, step_order").order("step_order");
  if (error) return { error: friendlyDbError(error) };
  const list = steps as { id: string; step_order: number }[];
  const index = list.findIndex((s) => s.id === stepId);
  const other = list[direction === "up" ? index - 1 : index + 1];
  if (index < 0 || !other) return { ok: true };
  const step = list[index]!;

  // Distinct orders even when two steps had the same number.
  const [first, second] = direction === "up" ? [step, other] : [other, step];
  const low = Math.min(step.step_order, other.step_order);
  const high = Math.max(step.step_order, other.step_order, low + 1);
  for (const [id, order] of [
    [first.id, low],
    [second.id, high],
  ] as const) {
    const update = await supabase.from("leave_approval_steps").update({ step_order: order }).eq("id", id).select("id");
    if (update.error) return { error: friendlyDbError(update.error) };
    if (!update.data?.length) return { error: "You can't change the approval chain." };
  }
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function addHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(hrModule);
  const parsed = holidaySchema.safeParse(formObject(formData, ["holiday_date", "name"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("public_holidays").insert(parsed.data);
  if (error) return settingsError(error, "There is already a holiday on that day.");
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function removeHoliday(holidayDate: string): Promise<ActionState> {
  await requireModule(hrModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("public_holidays").delete().eq("holiday_date", holidayDate).select("holiday_date");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change the public holidays." };
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}
