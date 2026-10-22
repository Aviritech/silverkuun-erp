import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { EnrolmentStatus, TrainingStatus } from "./constants";

export type Training = {
  id: string;
  title: string;
  description: string | null;
  trainer: string | null;
  starts_on: string;
  ends_on: string;
  hours: string | null;
  venue: string | null;
  is_virtual: boolean;
  meeting_url: string | null;
  capacity: number | null;
  cost_per_person: string | null;
  pass_mark: number | null;
  departments: string[];
  status: TrainingStatus;
  created_by: string;
  created_at: string;
};

export type Enrolment = {
  id: string;
  training_id: string;
  employee_id: string;
  status: EnrolmentStatus;
  hours_attended: string | null;
  score: string | null;
  passed: boolean | null;
  feedback_rating: number | null;
  feedback_comment: string | null;
  enrolled_by: string;
  enrolled_at: string;
  completed_at: string | null;
};

export type EnrolmentWithEmployee = Enrolment & {
  employees: { id: string; first_name: string; last_name: string; employee_no: string; branch_id: string; department_code: string } | null;
};

export type EnrolmentWithTraining = Enrolment & { trainings: Training };

export const today = () => new Date().toISOString().slice(0, 10);

/** A certificate is earned by completing the training and, when it is scored, passing. */
export function earnedCertificate(e: Pick<Enrolment, "status" | "passed">): boolean {
  return e.status === "completed" && e.passed === true;
}

export async function listTrainings(): Promise<Training[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("trainings").select("*").order("starts_on", { ascending: false }).limit(300);
  if (error) throw dbFailure(error);
  return data as Training[];
}

/** Places taken on each training, counting everyone who hasn't withdrawn. */
export async function seatsTaken(trainingIds: string[]): Promise<Map<string, number>> {
  if (trainingIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("training_seats_taken", { p_training_ids: trainingIds });
  if (error) throw dbFailure(error);
  return new Map(((data ?? []) as { training_id: string; taken: number }[]).map((r) => [r.training_id, r.taken]));
}

export async function getTraining(id: string): Promise<{ training: Training; enrolments: EnrolmentWithEmployee[] } | null> {
  const supabase = await createClient();
  const { data: training, error } = await supabase.from("trainings").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  if (!training) return null;
  const enrolments = await supabase
    .from("training_enrollments")
    .select("*, employees(id, first_name, last_name, employee_no, branch_id, department_code)")
    .eq("training_id", id)
    .order("enrolled_at");
  if (enrolments.error) throw dbFailure(enrolments.error);
  return { training: training as Training, enrolments: enrolments.data as unknown as EnrolmentWithEmployee[] };
}

export async function listMyEnrolments(employeeId: string): Promise<EnrolmentWithTraining[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_enrollments")
    .select("*, trainings(*)")
    .eq("employee_id", employeeId)
    .order("enrolled_at", { ascending: false });
  if (error) throw dbFailure(error);
  return data as unknown as EnrolmentWithTraining[];
}

export async function getMyEnrolment(enrolmentId: string, employeeId: string): Promise<EnrolmentWithTraining | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_enrollments")
    .select("*, trainings(*)")
    .eq("id", enrolmentId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) throw dbFailure(error);
  return data as unknown as EnrolmentWithTraining | null;
}
