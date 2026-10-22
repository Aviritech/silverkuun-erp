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
import { acknowledgeSchema, goalSchema, newReviewSchema, progressSchema, reviewNotesSchema, scoreSchema } from "./schemas";

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

async function requireReviewer() {
  await requireModule(hrModule);
  return requirePermission("performance.review");
}

function reviewPath(reviewId: string) {
  return `/hr/performance/${reviewId}`;
}

// ---------------------------------------------------------------------------
// Reviews (the reviewer)
// ---------------------------------------------------------------------------

export async function startReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireReviewer();
  const parsed = newReviewSchema.safeParse(formObject(formData, ["employee_id", "period_label", "period_start", "period_end"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("performance_reviews").insert(parsed.data).select("id").single();
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr/performance");
  redirect(reviewPath(data.id));
}

export async function addScore(reviewId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireReviewer();
  const parsed = scoreSchema.safeParse(formObject(formData, ["criterion", "target", "actual", "score", "comment"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("performance_review_scores")
    .select("sort_order")
    .eq("review_id", reviewId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("performance_review_scores")
    .insert({ ...parsed.data, review_id: reviewId, sort_order: (last?.sort_order ?? 0) + 1 });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(reviewPath(reviewId));
  return { ok: true };
}

export async function updateScore(reviewId: string, scoreId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireReviewer();
  const parsed = scoreSchema.safeParse(formObject(formData, ["criterion", "target", "actual", "score", "comment"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("performance_review_scores").update(parsed.data).eq("id", scoreId).eq("review_id", reviewId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change this score." };
  revalidatePath(reviewPath(reviewId));
  return { ok: true };
}

export async function removeScore(reviewId: string, scoreId: string): Promise<ActionState> {
  await requireReviewer();
  const supabase = await createClient();
  const { data, error } = await supabase.from("performance_review_scores").delete().eq("id", scoreId).eq("review_id", reviewId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't remove this score." };
  revalidatePath(reviewPath(reviewId));
  return { ok: true };
}

export async function saveReviewNotes(reviewId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireReviewer();
  const parsed = reviewNotesSchema.safeParse(formObject(formData, ["strengths", "improvements", "reviewer_comments", "next_review_date"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("performance_reviews").update(parsed.data).eq("id", reviewId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change this review." };
  revalidatePath(reviewPath(reviewId));
  return { ok: true, message: "Saved." };
}

export async function submitReview(reviewId: string): Promise<ActionState> {
  await requireReviewer();
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_performance_review", { p_review_id: reviewId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr/performance");
  revalidatePath(reviewPath(reviewId));
  return { ok: true };
}

export async function discardReview(reviewId: string): Promise<ActionState> {
  await requireReviewer();
  const supabase = await createClient();
  const { data, error } = await supabase.from("performance_reviews").delete().eq("id", reviewId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't discard this review." };
  revalidatePath("/hr/performance");
  redirect("/hr/performance");
}

// ---------------------------------------------------------------------------
// Goals (the reviewer)
// ---------------------------------------------------------------------------

export async function setGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireReviewer();
  const parsed = goalSchema.safeParse(formObject(formData, ["employee_id", "title", "goal_type", "target_date", "description"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("employee_goals").insert(parsed.data);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr/performance/goals");
  return { ok: true };
}

async function recordProgress(goalId: string, formData: FormData): Promise<ActionState> {
  const parsed = progressSchema.safeParse(formObject(formData, ["progress", "note"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_goal_progress", {
    p_goal_id: goalId,
    p_progress: parsed.data.progress,
    p_note: parsed.data.note,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/hr/performance/goals");
  revalidatePath("/me/performance");
  return { ok: true };
}

export async function updateGoalProgress(goalId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireReviewer();
  return recordProgress(goalId, formData);
}

export async function cancelGoal(goalId: string): Promise<ActionState> {
  await requireReviewer();
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_goals").update({ status: "cancelled" }).eq("id", goalId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't cancel this goal." };
  revalidatePath("/hr/performance/goals");
  revalidatePath("/me/performance");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// My performance (the employee)
// ---------------------------------------------------------------------------

export async function acknowledgeReview(reviewId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMyEmployee();
  const parsed = acknowledgeSchema.safeParse(formObject(formData, ["comments"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_performance_review", { p_review_id: reviewId, p_comments: parsed.data.comments });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/me/performance");
  revalidatePath(reviewPath(reviewId));
  return { ok: true };
}

export async function updateMyGoalProgress(goalId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMyEmployee();
  return recordProgress(goalId, formData);
}
