"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { requireMyEmployee } from "@/modules/me/queries";
import { hrModule } from "../module";
import { enrolSchema, feedbackSchema, resultSchema, trainingSchema } from "./schemas";

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

async function requireTrainingManager() {
  await requireModule(hrModule);
  return requirePermission("training.manage");
}

function trainingPath(trainingId: string) {
  return `/hr/training/${trainingId}`;
}

function refresh(trainingId: string) {
  revalidatePath("/hr/training");
  revalidatePath(trainingPath(trainingId));
  revalidatePath("/me/training");
}

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

export async function scheduleTraining(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireTrainingManager();
  const parsed = trainingSchema.safeParse({
    ...formObject(formData, ["title", "description", "trainer", "starts_on", "ends_on", "hours", "venue", "meeting_url", "capacity", "cost_per_person", "pass_mark"]),
    is_virtual: formData.get("is_virtual") === "on",
    departments: formData.getAll("departments").map(String),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("trainings").insert(parsed.data).select("id").single();
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr/training");
  revalidatePath("/me/training");
  redirect(trainingPath(data.id));
}

export async function setTrainingStatus(trainingId: string, status: "completed" | "cancelled"): Promise<ActionState> {
  await requireTrainingManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trainings")
    .update({ status })
    .eq("id", trainingId)
    .eq("status", "scheduled")
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "This training has already been closed." };
  refresh(trainingId);
  return { ok: true };
}

export async function enrolEmployee(trainingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireTrainingManager();
  const parsed = enrolSchema.safeParse(formObject(formData, ["employee_id"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("enrol_in_training", { p_training_id: trainingId, p_employee_id: parsed.data.employee_id });
  if (error) return { error: friendlyDbError(error) };
  refresh(trainingId);
  return { ok: true };
}

export async function withdrawEnrolment(trainingId: string, enrolmentId: string): Promise<ActionState> {
  await requireTrainingManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_from_training", { p_enrollment_id: enrolmentId });
  if (error) return { error: friendlyDbError(error) };
  refresh(trainingId);
  return { ok: true };
}

export async function recordResult(trainingId: string, enrolmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireTrainingManager();
  const parsed = resultSchema.safeParse(formObject(formData, ["status", "hours", "score"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_training_result", {
    p_enrollment_id: enrolmentId,
    p_status: parsed.data.status,
    p_hours: parsed.data.status === "completed" ? parsed.data.hours : null,
    p_score: parsed.data.status === "completed" ? parsed.data.score : null,
  });
  if (error) return { error: friendlyDbError(error) };
  refresh(trainingId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// My training (the employee)
// ---------------------------------------------------------------------------

export async function enrolMyself(trainingId: string): Promise<ActionState> {
  await requireMyEmployee();
  const supabase = await createClient();
  const { error } = await supabase.rpc("enrol_in_training", { p_training_id: trainingId });
  if (error) return { error: friendlyDbError(error) };
  refresh(trainingId);
  return { ok: true };
}

export async function withdrawMyself(trainingId: string, enrolmentId: string): Promise<ActionState> {
  await requireMyEmployee();
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_from_training", { p_enrollment_id: enrolmentId });
  if (error) return { error: friendlyDbError(error) };
  refresh(trainingId);
  return { ok: true };
}

export async function giveFeedback(trainingId: string, enrolmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMyEmployee();
  const parsed = feedbackSchema.safeParse(formObject(formData, ["rating", "comment"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("give_training_feedback", {
    p_enrollment_id: enrolmentId,
    p_rating: parsed.data.rating,
    p_comment: parsed.data.comment,
  });
  if (error) return { error: friendlyDbError(error) };
  refresh(trainingId);
  return { ok: true };
}
