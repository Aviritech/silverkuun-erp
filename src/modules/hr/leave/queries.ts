import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalScope, LeaveStatus, StepStatus } from "./constants";

export type LeaveType = {
  id: string;
  name: string;
  days_per_year: number;
  is_paid: boolean;
  uses_balance: boolean;
  prorate: boolean;
  max_days_per_request: number | null;
  document_after_days: number | null;
  extra_days_after_5_years: number;
  extra_days_after_10_years: number;
  only_for_gender: "female" | "male" | null;
  is_active: boolean;
  sort_order: number;
};

export type ApprovalStep = {
  id: string;
  step_order: number;
  name: string;
  job_title_ids: string[];
  scope: ApprovalScope;
  same_department: boolean;
  is_active: boolean;
};

export type Holiday = { holiday_date: string; name: string };

export type LeaveBalance = {
  leave_type_id: string;
  name: string;
  uses_balance: boolean;
  entitlement: number;
  taken: number;
  pending: number;
  /** Null for leave that doesn't come out of a balance, such as unpaid leave. */
  available: number | null;
};

export type LeaveRequest = {
  id: string;
  request_no: string;
  employee_id: string;
  branch_id: string;
  department_code: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  relief_employee_id: string | null;
  document_id: string | null;
  status: LeaveStatus;
  decision_note: string | null;
  decided_at: string | null;
  requested_by: string;
  requested_at: string;
  cancelled_at: string | null;
};

export type LeaveStep = {
  id: string;
  request_id: string;
  step_order: number;
  kind: "relief" | "chain" | "hr";
  name: string;
  job_title_ids: string[] | null;
  scope: ApprovalScope | null;
  same_department: boolean;
  status: StepStatus;
  acted_by: string | null;
  acted_at: string | null;
  comment: string | null;
};

export type Colleague = { id: string; full_name: string; job_title: string; branch_name: string };

export type PendingApproval = {
  request_id: string;
  request_no: string;
  employee_id: string;
  employee_name: string;
  job_title: string;
  branch_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  relief_name: string | null;
  step_name: string;
  step_kind: "relief" | "chain" | "hr";
  requested_at: string;
};

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function addDaysIso(days: number, from = todayIso()) {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pending requests can always be withdrawn; approved leave only until it starts. */
export function canCancel(request: Pick<LeaveRequest, "status" | "start_date">) {
  return request.status === "pending" || (request.status === "approved" && request.start_date > todayIso());
}

/** "With Branch or Marketing Manager", for showing where a pending request has got to. */
export function stepProgress(request: Pick<LeaveRequest, "status">, steps: LeaveStep[], reliefName?: string | null): string | null {
  if (request.status !== "pending") return null;
  const current = steps.find((s) => s.status === "pending");
  if (!current) return null;
  if (current.kind === "relief") return reliefName ? `With ${reliefName} to agree to cover` : "With the relief officer";
  return `With ${current.name}`;
}

export async function listLeaveTypes(): Promise<LeaveType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("leave_types").select("*").order("sort_order").order("name");
  if (error) throw dbFailure(error);
  return data as LeaveType[];
}

export async function listApprovalSteps(): Promise<ApprovalStep[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("leave_approval_steps").select("*").order("step_order");
  if (error) throw dbFailure(error);
  return data as ApprovalStep[];
}

export async function listHolidays(fromYear: number, toYear = fromYear): Promise<Holiday[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("public_holidays")
    .select("holiday_date, name")
    .gte("holiday_date", `${fromYear}-01-01`)
    .lte("holiday_date", `${toYear}-12-31`)
    .order("holiday_date");
  if (error) throw dbFailure(error);
  return data as Holiday[];
}

/** Empty when the signed-in staff member isn't allowed to see the employee's balances. */
export async function getLeaveBalances(employeeId: string, year = new Date().getFullYear()): Promise<LeaveBalance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leave_balances", { p_employee_id: employeeId, p_year: year });
  if (error) throw dbFailure(error);
  return (data ?? []) as LeaveBalance[];
}

export async function listColleagues(): Promise<Colleague[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("colleague_options");
  if (error) throw dbFailure(error);
  return (data ?? []) as Colleague[];
}

export async function listMyApprovals(): Promise<PendingApproval[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_leave_approvals");
  if (error) throw dbFailure(error);
  return (data ?? []) as PendingApproval[];
}

export async function staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_display_names", { p_ids: unique });
  if (error) throw dbFailure(error);
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
}

/** Steps of several requests at once, grouped by request. */
export async function stepsFor(requestIds: string[]): Promise<Map<string, LeaveStep[]>> {
  const out = new Map<string, LeaveStep[]>();
  if (requestIds.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase.from("leave_request_steps").select("*").in("request_id", requestIds).order("step_order");
  if (error) throw dbFailure(error);
  for (const s of data as LeaveStep[]) out.set(s.request_id, [...(out.get(s.request_id) ?? []), s]);
  return out;
}

type RequestEmployee = {
  id: string;
  first_name: string;
  last_name: string;
  employee_no: string;
  staff_id: string | null;
  job_title_id: string;
};

/** A request with everything its detail page shows, or null when it doesn't exist or can't be seen. */
export async function getLeaveRequest(requestId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leave_requests")
    .select(
      "*, employee:employees!leave_requests_employee_id_fkey(id, first_name, last_name, employee_no, staff_id, job_title_id), relief:employees!leave_requests_relief_employee_id_fkey(first_name, last_name), leave_type:leave_types(name, is_paid, uses_balance)",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw dbFailure(error);
  if (!data) return null;
  const request = data as LeaveRequest & {
    employee: RequestEmployee | null;
    relief: { first_name: string; last_name: string } | null;
    leave_type: { name: string; is_paid: boolean; uses_balance: boolean };
  };

  const [steps, colleagues, document, balances] = await Promise.all([
    stepsFor([request.id]).then((m) => m.get(request.id) ?? []),
    listColleagues(),
    request.document_id
      ? supabase.from("employee_documents").select("file_name, storage_path").eq("id", request.document_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getLeaveBalances(request.employee_id, Number(request.start_date.slice(0, 4))),
  ]);
  if (document.error) throw dbFailure(document.error);

  let documentUrl: string | undefined;
  const doc = document.data as { file_name: string; storage_path: string } | null;
  if (doc) {
    const signed = await supabase.storage.from("hr-documents").createSignedUrl(doc.storage_path, 120);
    documentUrl = signed.data?.signedUrl;
  }

  const names = await staffNames([request.requested_by, ...steps.map((s) => s.acted_by)]);
  const colleagueName = new Map(colleagues.map((c) => [c.id, c.full_name]));

  return {
    request,
    steps,
    // HR may not see a relief officer in another branch; the colleague list has every current one.
    reliefName: request.relief
      ? `${request.relief.first_name} ${request.relief.last_name}`
      : request.relief_employee_id
        ? (colleagueName.get(request.relief_employee_id) ?? "Relief officer")
        : null,
    document: doc ? { fileName: doc.file_name, url: documentUrl } : null,
    balance: balances.find((b) => b.leave_type_id === request.leave_type_id) ?? null,
    staffName: (id: string | null) => (id ? (names.get(id) ?? "Unknown") : "—"),
  };
}
