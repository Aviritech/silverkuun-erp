import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeStatus } from "../constants";
import type { GoalStatus, GoalType, ReviewStatus } from "./constants";

/** Someone a reviewer can see: name and where they work, nothing else from the HR file. */
export type PerformancePerson = {
  id: string;
  full_name: string;
  employee_no: string;
  branch_id: string;
  department_code: string;
  status: EmployeeStatus;
  is_me: boolean;
};

export type Review = {
  id: string;
  employee_id: string;
  reviewer_id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  status: ReviewStatus;
  overall_score: string | null;
  strengths: string | null;
  improvements: string | null;
  reviewer_comments: string | null;
  employee_comments: string | null;
  next_review_date: string | null;
  created_at: string;
  submitted_at: string | null;
  acknowledged_at: string | null;
};

export type ReviewScore = {
  id: string;
  criterion: string;
  target: string | null;
  actual: string | null;
  score: number;
  comment: string | null;
  sort_order: number;
};

export type Goal = {
  id: string;
  employee_id: string;
  title: string;
  description: string | null;
  goal_type: GoalType;
  target_date: string | null;
  progress: number;
  status: GoalStatus;
  progress_note: string | null;
  set_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export const today = () => new Date().toISOString().slice(0, 10);

export function isOverdue(goal: Pick<Goal, "status" | "target_date">): boolean {
  return goal.status === "open" && !!goal.target_date && goal.target_date < today();
}

/** Everyone in the branches where the signed-in staff member reads or gives reviews. */
export async function listPerformancePeople(): Promise<PerformancePerson[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("performance_people");
  if (error) throw dbFailure(error);
  return (data ?? []) as PerformancePerson[];
}

export async function staffNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_display_names", { p_ids: unique });
  if (error) throw dbFailure(error);
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
}

const REVIEW_LIMIT = 200;

export async function listReviews(filter: { status?: string; employeeIds?: string[] }): Promise<Review[]> {
  const supabase = await createClient();
  let query = supabase.from("performance_reviews").select("*").order("period_end", { ascending: false }).order("created_at", { ascending: false }).limit(REVIEW_LIMIT);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.employeeIds) query = query.in("employee_id", filter.employeeIds.length ? filter.employeeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) throw dbFailure(error);
  return data as Review[];
}

export async function getReview(id: string): Promise<{ review: Review; scores: ReviewScore[] } | null> {
  const supabase = await createClient();
  const { data: review, error } = await supabase.from("performance_reviews").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  if (!review) return null;
  const scores = await supabase
    .from("performance_review_scores")
    .select("id, criterion, target, actual, score, comment, sort_order")
    .eq("review_id", id)
    .order("sort_order");
  if (scores.error) throw dbFailure(scores.error);
  return { review: review as Review, scores: scores.data as ReviewScore[] };
}

export async function listReviewScores(reviewIds: string[]): Promise<Map<string, ReviewScore[]>> {
  const out = new Map<string, ReviewScore[]>();
  if (reviewIds.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("performance_review_scores")
    .select("id, review_id, criterion, target, actual, score, comment, sort_order")
    .in("review_id", reviewIds)
    .order("sort_order");
  if (error) throw dbFailure(error);
  for (const s of data as (ReviewScore & { review_id: string })[]) out.set(s.review_id, [...(out.get(s.review_id) ?? []), s]);
  return out;
}

const GOAL_LIMIT = 300;

export async function listGoals(filter: { status?: string; employeeIds?: string[] }): Promise<Goal[]> {
  const supabase = await createClient();
  let query = supabase.from("employee_goals").select("*").order("target_date", { ascending: true, nullsFirst: false }).order("created_at").limit(GOAL_LIMIT);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.employeeIds) query = query.in("employee_id", filter.employeeIds.length ? filter.employeeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) throw dbFailure(error);
  return data as Goal[];
}

/** The signed-in employee's own reviews (drafts are hidden from them) and goals. */
export async function getMyPerformance(employeeId: string): Promise<{ reviews: Review[]; goals: Goal[] }> {
  const supabase = await createClient();
  const [reviews, goals] = await Promise.all([
    supabase.from("performance_reviews").select("*").eq("employee_id", employeeId).neq("status", "draft").order("period_end", { ascending: false }),
    supabase.from("employee_goals").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false }),
  ]);
  if (reviews.error) throw dbFailure(reviews.error);
  if (goals.error) throw dbFailure(goals.error);
  return { reviews: reviews.data as Review[], goals: goals.data as Goal[] };
}
