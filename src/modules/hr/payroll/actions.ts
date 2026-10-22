"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { hrModule } from "../module";
import { COMPONENT_KEYS } from "./constants";
import { adjustmentSchema, deductionSchema, reasonSchema, runSchema, salarySchema, settingsSchema } from "./schemas";

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

async function guard(permission: string) {
  await requireModule(hrModule);
  return requirePermission(permission);
}

const runPath = (runId: string) => `/hr/payroll/${runId}`;
const payPath = (employeeId: string) => `/hr/employees/${employeeId}/pay`;

function runDone(runId: string, message?: string): ActionState {
  revalidatePath("/hr/payroll", "layout");
  revalidatePath(runPath(runId));
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------

export async function createRun(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await guard("payroll.prepare");
  const parsed = runSchema.safeParse(formObject(formData, ["period", "note"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_payroll_run", { p_period: parsed.data.period, p_note: parsed.data.note })
    .single<{ id: string }>();
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr/payroll");
  redirect(runPath(data.id));
}

async function runStep(runId: string, permission: string, fn: string, args: Record<string, unknown>, message?: string) {
  await guard(permission);
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendlyDbError(error) };
  return runDone(runId, message);
}

export async function recalculateRun(runId: string): Promise<ActionState> {
  return runStep(runId, "payroll.prepare", "recalculate_payroll_run", { p_run_id: runId });
}

export async function submitRun(runId: string): Promise<ActionState> {
  return runStep(runId, "payroll.prepare", "submit_payroll_run", { p_run_id: runId });
}

export async function cancelRun(runId: string): Promise<ActionState> {
  return runStep(runId, "payroll.prepare", "cancel_payroll_run", { p_run_id: runId });
}

export async function approveRun(runId: string): Promise<ActionState> {
  return runStep(runId, "payroll.approve", "approve_payroll_run", { p_run_id: runId });
}

export async function returnRun(runId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await guard("payroll.approve");
  const parsed = reasonSchema.safeParse(formObject(formData, ["reason"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return runStep(runId, "payroll.approve", "return_payroll_run", { p_run_id: runId, p_reason: parsed.data.reason });
}

export async function addAdjustment(runId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await guard("payroll.prepare");
  const parsed = adjustmentSchema.safeParse({
    ...formObject(formData, ["employee_id", "kind", "description", "amount"]),
    taxable: formData.get("taxable") === "on",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("payroll_adjustments").insert({ ...parsed.data, run_id: runId });
  if (error) return { error: friendlyDbError(error) };
  return runDone(runId, "Added. Recalculate to update the figures.");
}

export async function removeAdjustment(runId: string, adjustmentId: string): Promise<ActionState> {
  await guard("payroll.prepare");
  const supabase = await createClient();
  const { data, error } = await supabase.from("payroll_adjustments").delete().eq("id", adjustmentId).eq("run_id", runId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't remove this adjustment." };
  return runDone(runId, "Removed. Recalculate to update the figures.");
}

// ---------------------------------------------------------------------------
// Salaries
// ---------------------------------------------------------------------------

export async function proposeSalary(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await guard("payroll.prepare");
  const parsed = salarySchema.safeParse(formObject(formData, ["effective_from", ...COMPONENT_KEYS, "reason"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("employee_salaries").insert({ ...parsed.data, employee_id: employeeId });
  if (error) {
    if (error.code === "23505") return { error: "There is already a salary for that month. Withdraw it or choose another month." };
    return { error: friendlyDbError(error) };
  }
  revalidatePath(payPath(employeeId));
  revalidatePath("/hr/payroll");
  return { ok: true, message: "Proposed. Someone else with salary approval now has to approve it." };
}

export async function withdrawSalary(employeeId: string, salaryId: string): Promise<ActionState> {
  await guard("payroll.prepare");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_salaries")
    .delete()
    .eq("id", salaryId)
    .eq("employee_id", employeeId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can only withdraw your own proposals." };
  revalidatePath(payPath(employeeId));
  revalidatePath("/hr/payroll");
  return { ok: true };
}

async function decide(salaryId: string, approve: boolean, note: string | null): Promise<ActionState> {
  await guard("payroll.salaries.approve");
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("decide_salary", { p_id: salaryId, p_approve: approve, p_note: note })
    .single<{ employee_id: string }>();
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr/payroll");
  revalidatePath(payPath(data.employee_id));
  return { ok: true };
}

export async function approveSalary(salaryId: string): Promise<ActionState> {
  return decide(salaryId, true, null);
}

export async function rejectSalary(salaryId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await guard("payroll.salaries.approve");
  const parsed = reasonSchema.safeParse(formObject(formData, ["reason"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return decide(salaryId, false, parsed.data.reason);
}

// ---------------------------------------------------------------------------
// Deductions
// ---------------------------------------------------------------------------

export async function addDeduction(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await guard("payroll.prepare");
  const parsed = deductionSchema.safeParse(
    formObject(formData, ["kind", "description", "monthly_amount", "total_amount", "start_month", "end_month"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("employee_deductions").insert({ ...parsed.data, employee_id: employeeId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(payPath(employeeId));
  return { ok: true };
}

export async function stopDeduction(employeeId: string, deductionId: string): Promise<ActionState> {
  await guard("payroll.prepare");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_deductions")
    .update({ is_active: false })
    .eq("id", deductionId)
    .eq("employee_id", employeeId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't stop this deduction." };
  revalidatePath(payPath(employeeId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tax and pension settings
// ---------------------------------------------------------------------------

function parseBands(formData: FormData): { bands?: { upto: number | null; rate: number }[]; error?: string } {
  const uptos = formData.getAll("band_upto").map((v) => String(v).trim());
  const rates = formData.getAll("band_rate").map((v) => String(v).trim());
  if (rates.length === 0) return { error: "Give at least one PAYE band" };
  const bands: { upto: number | null; rate: number }[] = [];
  let previous = 0;
  for (let i = 0; i < rates.length; i++) {
    const last = i === rates.length - 1;
    const rate = Number(rates[i]);
    if (rates[i] === "" || !Number.isFinite(rate) || rate < 0 || rate > 100) return { error: `Band ${i + 1}: enter a rate from 0 to 100` };
    if (last) {
      bands.push({ upto: null, rate });
      continue;
    }
    const upto = Number(uptos[i]);
    if (uptos[i] === "" || !Number.isFinite(upto) || upto <= previous) {
      return { error: `Band ${i + 1}: enter an upper limit above ${previous.toLocaleString("en-NG")}` };
    }
    bands.push({ upto, rate });
    previous = upto;
  }
  return { bands };
}

export async function saveSettings(
  existingFrom: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await guard("payroll.config");
  const parsed = settingsSchema.safeParse({
    ...formObject(formData, ["pension_employee_rate", "pension_employer_rate", "nhf_rate", "rent_relief_rate", "rent_relief_cap", "note"]),
    // The start month of an existing version is its key, and draft runs point at it, so it can't change.
    effective_from: existingFrom ?? formData.get("effective_from") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { bands, error: bandError } = parseBands(formData);
  if (bandError) return { fieldErrors: { paye_bands: bandError } };

  const supabase = await createClient();
  if (existingFrom) {
    const { effective_from, ...change } = parsed.data;
    const { data, error } = await supabase
      .from("payroll_settings")
      .update({ ...change, paye_bands: bands })
      .eq("effective_from", effective_from)
      .select("effective_from");
    if (error) return { error: friendlyDbError(error) };
    if (!data?.length) return { error: "An approved payroll already uses these settings, so they can't change. Add a new version instead." };
  } else {
    const { error } = await supabase.from("payroll_settings").insert({ ...parsed.data, paye_bands: bands });
    if (error) {
      if (error.code === "23505") return { error: "There are already settings starting that month. Edit them instead." };
      return { error: friendlyDbError(error) };
    }
  }
  revalidatePath("/hr/payroll/settings");
  return { ok: true, message: "Saved. Recalculate any draft payroll to use them." };
}
