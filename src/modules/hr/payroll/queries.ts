import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import type { AdjustmentKind, DeductionKind, RunStatus, SalaryComponent, SalaryStatus } from "./constants";

export type PayrollRun = {
  id: string;
  period: string;
  status: RunStatus;
  settings_from: string;
  note: string | null;
  return_reason: string | null;
  prepared_by: string;
  prepared_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

export type PayrollLine = Record<SalaryComponent, number> & {
  id: string;
  run_id: string;
  employee_id: string;
  branch_id: string;
  department_code: string;
  job_title_id: string;
  days_paid: number;
  days_in_month: number;
  commission: number;
  extra_taxable: number;
  extra_non_taxable: number;
  gross: number;
  pension_employee: number;
  pension_employer: number;
  nhf: number;
  rent_relief: number;
  annual_taxable: number;
  paye: number;
  deductions: number;
  net: number;
  bank_name: string | null;
  bank_account_number: string | null;
  pension_administrator: string | null;
  pension_pin: string | null;
  tax_id: string | null;
};

export type LineDeduction = { id: string; line_id: string; deduction_id: string | null; kind: string; description: string; amount: number };

export type Adjustment = {
  id: string;
  employee_id: string;
  kind: AdjustmentKind;
  description: string;
  amount: number;
  taxable: boolean;
  created_by: string;
  created_at: string;
};

export type Salary = Record<SalaryComponent, number> & {
  id: string;
  employee_id: string;
  effective_from: string;
  reason: string;
  status: SalaryStatus;
  proposed_by: string;
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

export type Deduction = {
  id: string;
  kind: DeductionKind;
  description: string;
  monthly_amount: number;
  total_amount: number | null;
  start_month: string;
  end_month: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
};

export type PayeBand = { upto: number | null; rate: number };

export type PayrollSettings = {
  effective_from: string;
  pension_employee_rate: number;
  pension_employer_rate: number;
  nhf_rate: number;
  rent_relief_rate: number;
  rent_relief_cap: number;
  paye_bands: PayeBand[];
  note: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type PersonRef = { id: string; employee_no: string; title: string | null; first_name: string; last_name: string };

export function personName(p: PersonRef | undefined): string {
  return p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "Employee not visible to you";
}

export type RunTotals = {
  people: number;
  gross: number;
  pension_employee: number;
  pension_employer: number;
  nhf: number;
  paye: number;
  deductions: number;
  net: number;
};

export function runTotals(lines: Pick<PayrollLine, keyof Omit<RunTotals, "people">>[]): RunTotals {
  const totals: RunTotals = { people: lines.length, gross: 0, pension_employee: 0, pension_employer: 0, nhf: 0, paye: 0, deductions: 0, net: 0 };
  for (const l of lines) {
    totals.gross += Number(l.gross);
    totals.pension_employee += Number(l.pension_employee);
    totals.pension_employer += Number(l.pension_employer);
    totals.nhf += Number(l.nhf);
    totals.paye += Number(l.paye);
    totals.deductions += Number(l.deductions);
    totals.net += Number(l.net);
  }
  return totals;
}

async function staffNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return (id: string | null) => (id ? "Unknown" : "—");
  const supabase = await createClient();
  const { data } = await supabase.rpc("staff_display_names", { p_ids: unique });
  const names = new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
  return (id: string | null) => (id ? (names.get(id) ?? "Unknown") : "—");
}

async function people(ids: string[]): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  // Names only, so payroll staff who can't read HR files (the Financial Controller) still see who is paid.
  const { data, error } = await supabase.rpc("pay_people", { p_employee_ids: unique });
  if (error) throw dbFailure(error);
  const rows = (data ?? []) as { id: string; full_name: string; employee_no: string }[];
  return new Map(rows.map((p) => [p.id, { id: p.id, employee_no: p.employee_no, title: null, first_name: p.full_name, last_name: "" }]));
}

/** Names for branches, departments and job titles, which everyone can read. */
async function labels() {
  const supabase = await createClient();
  const [org, departments, titles] = await Promise.all([
    listOrg(),
    supabase.from("departments").select("code, name"),
    supabase.from("job_titles").select("id, name"),
  ]);
  if (departments.error) throw dbFailure(departments.error);
  if (titles.error) throw dbFailure(titles.error);
  const branch = new Map(org.branches.map((b) => [b.id, b.name]));
  const department = new Map((departments.data as { code: string; name: string }[]).map((d) => [d.code, d.name]));
  const title = new Map((titles.data as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  return {
    branches: org.branches,
    branch: (id: string) => branch.get(id) ?? "—",
    department: (code: string) => department.get(code) ?? code,
    jobTitle: (id: string) => title.get(id) ?? "—",
  };
}

export async function listRuns() {
  const supabase = await createClient();
  const { data: runs, error } = await supabase.from("payroll_runs").select("*").order("period", { ascending: false }).limit(60);
  if (error) throw dbFailure(error);
  const ids = (runs as PayrollRun[]).map((r) => r.id);
  const { data: lines, error: linesError } = ids.length
    ? await supabase.from("payroll_lines").select("run_id, gross, pension_employee, pension_employer, nhf, paye, deductions, net").in("run_id", ids)
    : { data: [], error: null };
  if (linesError) throw dbFailure(linesError);
  const byRun = new Map<string, PayrollLine[]>();
  for (const l of (lines ?? []) as PayrollLine[]) byRun.set(l.run_id, [...(byRun.get(l.run_id) ?? []), l]);
  return (runs as PayrollRun[]).map((run) => ({ run, totals: runTotals(byRun.get(run.id) ?? []) }));
}

export async function listPendingSalaries() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_salaries").select("*").eq("status", "pending").order("proposed_at");
  if (error) throw dbFailure(error);
  const salaries = data as Salary[];
  const [who, staffName] = await Promise.all([people(salaries.map((s) => s.employee_id)), staffNames(salaries.map((s) => s.proposed_by))]);
  return { salaries, person: (id: string) => who.get(id), staffName };
}

export async function getRunBundle(runId: string) {
  const supabase = await createClient();
  const { data: run, error } = await supabase.from("payroll_runs").select("*").eq("id", runId).maybeSingle();
  if (error) throw dbFailure(error);
  if (!run) return null;
  const r = run as PayrollRun;

  const [lines, adjustments, missing, journals, names] = await Promise.all([
    supabase.from("payroll_lines").select("*").eq("run_id", runId),
    supabase.from("payroll_adjustments").select("*").eq("run_id", runId).order("created_at"),
    r.status === "draft" || r.status === "submitted"
      ? supabase.rpc("payroll_missing_salaries", { p_period: r.period })
      : Promise.resolve({ data: [], error: null }),
    // Only staff with Accounts access can see the journals; everyone else gets an empty list.
    supabase.from("journal_entries").select("id, entry_no, branch_id, status").eq("payroll_run_id", runId).order("entry_no"),
    labels(),
  ]);
  for (const res of [lines, adjustments, missing, journals]) if (res.error) throw dbFailure(res.error);

  const lineRows = (lines.data ?? []) as PayrollLine[];
  const adjustmentRows = (adjustments.data ?? []) as Adjustment[];
  const [who, staffName] = await Promise.all([
    people([...lineRows.map((l) => l.employee_id), ...adjustmentRows.map((a) => a.employee_id)]),
    staffNames([r.prepared_by, r.submitted_by, r.approved_by]),
  ]);
  lineRows.sort((a, b) => (who.get(a.employee_id)?.employee_no ?? "").localeCompare(who.get(b.employee_id)?.employee_no ?? ""));

  return {
    run: r,
    lines: lineRows,
    adjustments: adjustmentRows,
    missing: (missing.data ?? []) as { employee_id: string; employee_no: string; full_name: string }[],
    journals: (journals.data ?? []) as { id: string; entry_no: string; branch_id: string; status: string }[],
    person: (id: string) => who.get(id),
    staffName,
    ...names,
  };
}

export type Payslip = {
  run: PayrollRun;
  line: PayrollLine;
  deductions: LineDeduction[];
  employee: PersonRef | undefined;
  branch: string;
  department: string;
  jobTitle: string;
};

/**
 * One payslip. Row level security decides who can see it: payroll readers see every one, employees only their
 * own and only once the run is approved. `employeeId` narrows it to that employee, for "My HR".
 */
export async function getPayslip(lineId: string, opts: { runId?: string; employeeId?: string }): Promise<Payslip | null> {
  const supabase = await createClient();
  let query = supabase.from("payroll_lines").select("*").eq("id", lineId);
  if (opts.runId) query = query.eq("run_id", opts.runId);
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  const { data: line, error } = await query.maybeSingle();
  if (error) throw dbFailure(error);
  if (!line) return null;
  const l = line as PayrollLine;

  const [run, deductions, who, names] = await Promise.all([
    supabase.from("payroll_runs").select("*").eq("id", l.run_id).maybeSingle(),
    supabase.from("payroll_line_deductions").select("*").eq("line_id", lineId).order("kind"),
    people([l.employee_id]),
    labels(),
  ]);
  if (run.error) throw dbFailure(run.error);
  if (deductions.error) throw dbFailure(deductions.error);
  if (!run.data) return null;

  return {
    run: run.data as PayrollRun,
    line: l,
    deductions: (deductions.data ?? []) as LineDeduction[],
    employee: who.get(l.employee_id),
    branch: names.branch(l.branch_id),
    department: names.department(l.department_code),
    jobTitle: names.jobTitle(l.job_title_id),
  };
}

/** The employee's own payslips; row level security only returns lines of approved runs. */
export async function listMyPayslips(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payroll_lines")
    .select("id, gross, deductions, paye, pension_employee, nhf, net, payroll_runs!inner(period, status)")
    .eq("employee_id", employeeId)
    .eq("payroll_runs.status", "approved");
  if (error) throw dbFailure(error);
  type Row = Pick<PayrollLine, "id" | "gross" | "deductions" | "paye" | "pension_employee" | "nhf" | "net"> & {
    payroll_runs: { period: string; status: RunStatus };
  };
  return ((data ?? []) as unknown as Row[]).sort((a, b) => b.payroll_runs.period.localeCompare(a.payroll_runs.period));
}

export async function listSettings() {
  const supabase = await createClient();
  const [settings, runs] = await Promise.all([
    supabase.from("payroll_settings").select("*").order("effective_from", { ascending: false }),
    supabase.from("payroll_runs").select("settings_from").eq("status", "approved"),
  ]);
  if (settings.error) throw dbFailure(settings.error);
  if (runs.error) throw dbFailure(runs.error);
  const rows = settings.data as PayrollSettings[];
  const used = new Set(((runs.data ?? []) as { settings_from: string }[]).map((r) => r.settings_from));
  const staffName = await staffNames(rows.map((s) => s.updated_by));
  return { settings: rows, usedByApprovedRun: (from: string) => used.has(from), staffName };
}

export async function getEmployeePay(employeeId: string) {
  const supabase = await createClient();
  const { data: employee, error } = await supabase
    .from("employees")
    .select("id, employee_no, title, first_name, last_name, status, staff_id, branch_id, annual_rent, pension_applies, nhf_applies")
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw dbFailure(error);
  if (!employee) return null;

  const [salaries, deductions, commissions, payslips] = await Promise.all([
    supabase.from("employee_salaries").select("*").eq("employee_id", employeeId).order("effective_from", { ascending: false }).order("proposed_at", { ascending: false }),
    supabase.from("employee_deductions").select("*").eq("employee_id", employeeId).order("start_month", { ascending: false }),
    supabase.from("commission_payouts").select("id, description, amount, payable_from, status, approved_at").eq("employee_id", employeeId).order("approved_at", { ascending: false }),
    supabase
      .from("payroll_lines")
      .select("id, run_id, gross, net, payroll_runs!inner(period, status)")
      .eq("employee_id", employeeId)
      .neq("payroll_runs.status", "cancelled"),
  ]);
  for (const res of [salaries, deductions, commissions, payslips]) if (res.error) throw dbFailure(res.error);

  const deductionRows = (deductions.data ?? []) as Deduction[];
  const recovered = new Map<string, number>();
  if (deductionRows.length) {
    const { data, error: recoveredError } = await supabase
      .from("payroll_line_deductions")
      .select("deduction_id, amount, payroll_lines!inner(payroll_runs!inner(status))")
      .in(
        "deduction_id",
        deductionRows.map((d) => d.id),
      )
      .eq("payroll_lines.payroll_runs.status", "approved");
    if (recoveredError) throw dbFailure(recoveredError);
    for (const r of (data ?? []) as { deduction_id: string; amount: number }[]) {
      recovered.set(r.deduction_id, (recovered.get(r.deduction_id) ?? 0) + Number(r.amount));
    }
  }

  const salaryRows = (salaries.data ?? []) as Salary[];
  const staffName = await staffNames([
    ...salaryRows.flatMap((s) => [s.proposed_by, s.decided_by]),
    ...deductionRows.map((d) => d.created_by),
  ]);

  type PayslipRow = { id: string; run_id: string; gross: number; net: number; payroll_runs: { period: string; status: RunStatus } };
  return {
    employee: employee as PersonRef & {
      status: string;
      staff_id: string | null;
      branch_id: string;
      annual_rent: number | null;
      pension_applies: boolean;
      nhf_applies: boolean;
    },
    salaries: salaryRows,
    deductions: deductionRows,
    recovered: (id: string) => recovered.get(id) ?? 0,
    commissions: (commissions.data ?? []) as {
      id: string;
      description: string;
      amount: number;
      payable_from: string;
      status: "approved" | "paid" | "cancelled";
      approved_at: string;
    }[],
    payslips: ((payslips.data ?? []) as unknown as PayslipRow[]).sort((a, b) => b.payroll_runs.period.localeCompare(a.payroll_runs.period)),
    staffName,
  };
}
