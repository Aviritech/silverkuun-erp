import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { ContractType, DocumentType, EmployeeStatus, JobEvent } from "./constants";

export type JobTitle = { id: string; name: string; is_active: boolean };
export type Department = { code: string; name: string };

export type Employee = {
  id: string;
  employee_no: string;
  staff_id: string | null;
  status: EmployeeStatus;
  branch_id: string;
  department_code: string;
  job_title_id: string;
  employment_type: string;
  hire_date: string;
  probation_end_date: string | null;
  confirmed_on: string | null;
  exit_date: string | null;
  exit_reason: string | null;
  title: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  gender: "female" | "male" | null;
  marital_status: string | null;
  phone: string;
  personal_email: string | null;
  work_email: string | null;
  address: string;
  state_of_origin: string | null;
  nationality: string | null;
  nin: string | null;
  id_type: string | null;
  id_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  pension_administrator: string | null;
  pension_pin: string | null;
  tax_id: string | null;
  annual_rent: number | null;
  pension_applies: boolean;
  nhf_applies: boolean;
  created_by: string;
  created_at: string;
};

export type EmployeeDocument = {
  id: string;
  document_type: DocumentType;
  file_name: string;
  storage_path: string;
  mime_type: string;
  uploaded_at: string;
};

export type Contract = {
  id: string;
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  terminated_on: string | null;
  notes: string | null;
  created_at: string;
};

export type JobHistoryLine = {
  id: string;
  event: JobEvent;
  effective_date: string;
  branch_id: string;
  department_code: string;
  job_title_id: string;
  reason: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

export type LoginStatus = { is_active: boolean; must_change_password: boolean; roles: string[] };

export type Dependent = { id: string; full_name: string; relationship: string; date_of_birth: string | null };

export type Qualification = {
  id: string;
  kind: "education" | "professional";
  qualification: string;
  course: string | null;
  institution: string | null;
  year_obtained: number | null;
  expires_on: string | null;
};

export function employeeName(e: Pick<Employee, "title" | "first_name" | "middle_name" | "last_name">): string {
  return [e.title, e.first_name, e.middle_name, e.last_name].filter(Boolean).join(" ");
}

/** The contract in force on a date: started, not ended early and not past its end date. */
export function currentContract(contracts: Contract[], on = new Date().toISOString().slice(0, 10)): Contract | undefined {
  return contracts
    .filter((c) => c.start_date <= on && !c.terminated_on && (!c.end_date || c.end_date >= on))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
}

export async function listJobTitles(): Promise<JobTitle[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_titles").select("id, name, is_active").order("name");
  if (error) throw dbFailure(error);
  return data;
}

export async function listDepartments(): Promise<Department[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("departments").select("code, name").eq("is_active", true).order("name");
  if (error) throw dbFailure(error);
  return data;
}

export async function getEmployeeBundle(employeeId: string) {
  const supabase = await createClient();
  const { data: employee, error } = await supabase.from("employees").select("*").eq("id", employeeId).maybeSingle();
  if (error) throw dbFailure(error);
  if (!employee) return null;

  const [documents, contracts, history, dependents, qualifications, login] = await Promise.all([
    supabase.from("employee_documents").select("id, document_type, file_name, storage_path, mime_type, uploaded_at").eq("employee_id", employeeId).order("uploaded_at"),
    supabase.from("employee_contracts").select("id, contract_type, start_date, end_date, terminated_on, notes, created_at").eq("employee_id", employeeId).order("start_date"),
    supabase.from("employee_job_history").select("*").eq("employee_id", employeeId).order("effective_date").order("recorded_at"),
    supabase.from("employee_dependents").select("id, full_name, relationship, date_of_birth").eq("employee_id", employeeId).order("created_at"),
    supabase.from("employee_qualifications").select("id, kind, qualification, course, institution, year_obtained, expires_on").eq("employee_id", employeeId).order("year_obtained", { ascending: false, nullsFirst: false }),
    employee.staff_id ? supabase.rpc("employee_login_status", { p_employee_id: employeeId }) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [documents, contracts, history, dependents, qualifications, login]) if (r.error) throw dbFailure(r.error);

  const docs = (documents.data ?? []) as EmployeeDocument[];
  const signed = docs.length
    ? await supabase.storage.from("hr-documents").createSignedUrls(docs.map((d) => d.storage_path), 120)
    : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  const lines = (history.data ?? []) as JobHistoryLine[];
  const staffIds = [...new Set([employee.created_by, ...lines.map((l) => l.recorded_by)].filter(Boolean))];
  const { data: staff } = staffIds.length ? await supabase.rpc("staff_display_names", { p_ids: staffIds }) : { data: [] };
  const staffNames = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));

  const photo = [...docs].reverse().find((d) => d.document_type === "passport_photo" && d.mime_type.startsWith("image/"));

  return {
    employee: employee as Employee,
    documents: docs.map((d) => ({ ...d, url: urls.get(d.storage_path) })),
    photoUrl: photo ? urls.get(photo.storage_path) : undefined,
    contracts: (contracts.data ?? []) as Contract[],
    history: lines,
    dependents: (dependents.data ?? []) as Dependent[],
    qualifications: (qualifications.data ?? []) as Qualification[],
    /** The linked ERP login, or null when the employee has none. */
    login: ((login.data ?? []) as LoginStatus[])[0] ?? null,
    staffName: (id: string | null) => (id ? (staffNames.get(id) ?? "Unknown") : "—"),
  };
}
