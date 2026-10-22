import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";
import type { Column, ReportDefinition, ReportFilters, Row } from "@/lib/reports/types";
import { fetchAll } from "@/modules/credit/book";
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, type EmployeeStatus } from "./constants";
import { PAYOUT_STATUSES, type PayoutStatus, type TargetStatus } from "./commissions/constants";

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

type Branch = { id: string; name: string; region_id: string };
type Person = { id: string; full_name: string; employee_no: string; branch_id: string };

const employeeHref = (id: string) => `/hr/employees/${id}`;
const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);

async function lookups(supabase: SupabaseClient) {
  const [branches, departments, titles] = await Promise.all([
    supabase.from("branches").select("id, name, region_id"),
    supabase.from("departments").select("code, name"),
    supabase.from("job_titles").select("id, name"),
  ]);
  for (const r of [branches, departments, titles]) if (r.error) throw dbFailure(r.error);
  return {
    branches: new Map((branches.data as Branch[]).map((b) => [b.id, b])),
    departments: new Map((departments.data as { code: string; name: string }[]).map((d) => [d.code, d.name])),
    titles: new Map((titles.data as { id: string; name: string }[]).map((t) => [t.id, t.name])),
  };
}

/** Whether a branch is inside the branch and region filters. */
function branchMatcher(f: ReportFilters, branches: Map<string, Branch>) {
  return (branchId: string | null | undefined) =>
    (!f.branch || branchId === f.branch) && (!f.region || (branchId != null && branches.get(branchId)?.region_id === f.region));
}

/** Names for employees, through pay_people so payroll readers who don't read HR files still get them. */
async function people(supabase: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.rpc("pay_people", { p_employee_ids: unique });
  if (error) throw dbFailure(error);
  return new Map((data as Person[]).map((p) => [p.id, p]));
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function totalRow(rows: Row[], firstKey: string, label: string, keys: string[]): Row {
  const total: Row = { [firstKey]: label, _kind: "total" };
  for (const k of keys) total[k] = round2(rows.reduce((s, r) => s + num(r[k]), 0));
  return total;
}

const monthLabel = (period: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}T00:00:00Z`));

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

type EmployeeRow = {
  id: string;
  employee_no: string;
  status: EmployeeStatus;
  branch_id: string;
  department_code: string;
  job_title_id: string;
  employment_type: keyof typeof EMPLOYMENT_TYPES;
  hire_date: string;
  confirmed_on: string | null;
  exit_date: string | null;
  title: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  phone: string;
  work_email: string | null;
};

const STAFF_STATUS: Record<string, EmployeeStatus[]> = {
  current: ["probation", "active"],
  left: ["resigned", "terminated"],
  all: ["probation", "active", "resigned", "terminated"],
};

const staffRegister: ReportDefinition = {
  key: "staff-register",
  title: "Staff register",
  description: "Everyone on the books with their job, branch, department, status and key dates.",
  basePath: "/hr",
  permission: "hr.read",
  dates: "none",
  branchFilter: true,
  options: [
    {
      name: "status",
      label: "Who",
      choices: [
        { value: "current", label: "Current staff" },
        { value: "left", label: "Staff who have left" },
        { value: "all", label: "Everyone" },
      ],
    },
  ],
  async run(supabase, f) {
    const [{ branches, departments, titles }, employees] = await Promise.all([
      lookups(supabase),
      fetchAll<EmployeeRow>((from, to) =>
        supabase
          .from("employees")
          .select(
            "id, employee_no, status, branch_id, department_code, job_title_id, employment_type, hire_date, confirmed_on, exit_date, title, first_name, middle_name, last_name, phone, work_email",
          )
          .in("status", STAFF_STATUS[f.options.status] ?? STAFF_STATUS.current)
          .order("last_name")
          .order("first_name")
          .order("id")
          .range(from, to),
      ),
    ]);
    const inScope = branchMatcher(f, branches);
    const rows: Row[] = employees
      .filter((e) => inScope(e.branch_id))
      .map((e) => ({
        employee_no: e.employee_no,
        _href: employeeHref(e.id),
        name: [e.title, e.first_name, e.middle_name, e.last_name].filter(Boolean).join(" "),
        job_title: titles.get(e.job_title_id),
        department: departments.get(e.department_code) ?? e.department_code,
        branch: branches.get(e.branch_id)?.name,
        status: EMPLOYEE_STATUSES[e.status].label,
        type: EMPLOYMENT_TYPES[e.employment_type],
        hired: e.hire_date,
        confirmed: e.confirmed_on,
        left: e.exit_date,
        phone: e.phone,
        email: e.work_email,
      }));
    return {
      columns: [
        { key: "employee_no", label: "Employee no." },
        { key: "name", label: "Name" },
        { key: "job_title", label: "Job title" },
        { key: "department", label: "Department" },
        { key: "branch", label: "Branch" },
        { key: "status", label: "Status" },
        { key: "type", label: "Employment" },
        { key: "hired", label: "Hired", kind: "date" },
        { key: "confirmed", label: "Confirmed", kind: "date" },
        { key: "left", label: "Left", kind: "date" },
        { key: "phone", label: "Phone" },
        { key: "email", label: "Work email" },
      ],
      rows,
      notes: [`${rows.length} ${rows.length === 1 ? "person" : "people"}.`],
    };
  },
};

type HistoryLine = { employee_id: string; effective_date: string; branch_id: string; department_code: string; recorded_at: string };

const headcount: ReportDefinition = {
  key: "headcount-turnover",
  title: "Headcount and turnover",
  description: "Staff at the start and end of the period by branch and department, with joiners, leavers and staff turnover.",
  basePath: "/hr",
  permission: "hr.read",
  dates: "period",
  branchFilter: true,
  async run(supabase, f) {
    const [{ branches, departments }, employees, history] = await Promise.all([
      lookups(supabase),
      fetchAll<Pick<EmployeeRow, "id" | "branch_id" | "department_code" | "hire_date" | "exit_date">>((from, to) =>
        supabase.from("employees").select("id, branch_id, department_code, hire_date, exit_date").order("id").range(from, to),
      ),
      fetchAll<HistoryLine>((from, to) =>
        supabase
          .from("employee_job_history")
          .select("employee_id, effective_date, branch_id, department_code, recorded_at")
          .order("id")
          .range(from, to),
      ),
    ]);

    const linesFor = new Map<string, HistoryLine[]>();
    for (const h of history) linesFor.set(h.employee_id, [...(linesFor.get(h.employee_id) ?? []), h]);
    for (const lines of linesFor.values()) {
      lines.sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.recorded_at.localeCompare(b.recorded_at));
    }
    // Where someone worked on a date, from their job history; their current place if there's no history.
    const placeOn = (e: (typeof employees)[number], date: string) => {
      const line = (linesFor.get(e.id) ?? []).filter((l) => l.effective_date <= date).at(-1);
      return line ? { branch: line.branch_id, department: line.department_code } : { branch: e.branch_id, department: e.department_code };
    };

    type Counts = { start: number; joiners: number; leavers: number; end: number };
    const groups = new Map<string, Counts & { branch: string; department: string }>();
    const inScope = branchMatcher(f, branches);
    const add = (place: { branch: string; department: string }, key: keyof Counts) => {
      if (!inScope(place.branch)) return;
      const id = `${place.branch}|${place.department}`;
      const g = groups.get(id) ?? { branch: place.branch, department: place.department, start: 0, joiners: 0, leavers: 0, end: 0 };
      g[key] += 1;
      groups.set(id, g);
    };
    for (const e of employees) {
      if (e.hire_date < f.from && (!e.exit_date || e.exit_date >= f.from)) add(placeOn(e, f.from), "start");
      if (e.hire_date >= f.from && e.hire_date <= f.to) add(placeOn(e, e.hire_date), "joiners");
      if (e.exit_date && e.exit_date >= f.from && e.exit_date <= f.to) add(placeOn(e, e.exit_date), "leavers");
      if (e.hire_date <= f.to && (!e.exit_date || e.exit_date > f.to)) add(placeOn(e, f.to), "end");
    }

    const line = (label: string, c: Counts, kind?: Row["_kind"]): Row => {
      const average = (c.start + c.end) / 2;
      return {
        name: label,
        _kind: kind,
        start: c.start,
        joiners: c.joiners,
        leavers: c.leavers,
        transfers: c.end - (c.start + c.joiners - c.leavers),
        end: c.end,
        turnover: average > 0 ? Math.round((c.leavers / average) * 1000) / 10 : null,
      };
    };
    const sum = (items: Counts[]): Counts =>
      items.reduce((t, c) => ({ start: t.start + c.start, joiners: t.joiners + c.joiners, leavers: t.leavers + c.leavers, end: t.end + c.end }), {
        start: 0,
        joiners: 0,
        leavers: 0,
        end: 0,
      });

    const byBranch = new Map<string, (Counts & { department: string })[]>();
    for (const g of groups.values()) byBranch.set(g.branch, [...(byBranch.get(g.branch) ?? []), g]);
    const rows: Row[] = [];
    const branchName = (id: string) => branches.get(id)?.name ?? "Unknown branch";
    for (const [branchId, items] of [...byBranch].sort((a, b) => branchName(a[0]).localeCompare(branchName(b[0])))) {
      rows.push({ name: branchName(branchId), _kind: "heading" });
      const named = items.map((i) => ({ ...i, label: departments.get(i.department) ?? i.department }));
      for (const i of named.sort((a, b) => a.label.localeCompare(b.label))) rows.push(line(i.label, i));
      rows.push(line(`${branchName(branchId)} total`, sum(items), "subtotal"));
    }
    if (groups.size) rows.push(line("All branches", sum([...groups.values()]), "total"));

    return {
      columns: [
        { key: "name", label: "Branch and department" },
        { key: "start", label: "At start", kind: "number" },
        { key: "joiners", label: "Joined", kind: "number" },
        { key: "leavers", label: "Left", kind: "number" },
        { key: "transfers", label: "Transfers (net)", kind: "number" },
        { key: "end", label: "At end", kind: "number" },
        { key: "turnover", label: "Turnover %", kind: "number" },
      ],
      rows,
      notes: [
        "Turnover is leavers as a percentage of the average of the start and end headcounts.",
        "Staff are counted where they worked on each date, so transfers between branches or departments show in the transfers column.",
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

const LEAVE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const leaveRegister: ReportDefinition = {
  key: "leave-register",
  title: "Leave register",
  description: "Leave requests that fall in the period, with their type, days and status.",
  basePath: "/hr",
  permission: "hr.read",
  dates: "period",
  branchFilter: true,
  options: [
    {
      name: "status",
      label: "Status",
      choices: [
        { value: "all", label: "All requests" },
        { value: "approved", label: "Approved" },
        { value: "pending", label: "Pending" },
        { value: "rejected", label: "Rejected" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
  ],
  async run(supabase, f) {
    type LeaveRow = {
      id: string;
      request_no: string;
      employee_id: string;
      branch_id: string;
      leave_type_id: string;
      start_date: string;
      end_date: string;
      days: number;
      status: string;
      requested_at: string;
    };
    const [{ branches }, types, requests] = await Promise.all([
      lookups(supabase),
      supabase.from("leave_types").select("id, name"),
      fetchAll<LeaveRow>((from, to) => {
        let q = supabase
          .from("leave_requests")
          .select("id, request_no, employee_id, branch_id, leave_type_id, start_date, end_date, days, status, requested_at")
          .lte("start_date", f.to)
          .gte("end_date", f.from)
          .order("start_date")
          .order("request_no")
          .range(from, to);
        if (f.options.status !== "all") q = q.eq("status", f.options.status);
        return q;
      }),
    ]);
    if (types.error) throw dbFailure(types.error);
    const typeName = new Map((types.data as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    const inScope = branchMatcher(f, branches);
    const chosen = requests.filter((r) => inScope(r.branch_id));
    const names = await people(supabase, chosen.map((r) => r.employee_id));
    const rows: Row[] = chosen.map((r) => ({
      request_no: r.request_no,
      employee_no: names.get(r.employee_id)?.employee_no,
      name: names.get(r.employee_id)?.full_name ?? "Employee",
      branch: branches.get(r.branch_id)?.name,
      type: typeName.get(r.leave_type_id),
      start: r.start_date,
      end: r.end_date,
      days: r.days,
      status: LEAVE_STATUS_LABELS[r.status] ?? r.status,
      requested: r.requested_at,
    }));
    return {
      columns: [
        { key: "request_no", label: "Request" },
        { key: "employee_no", label: "Employee no." },
        { key: "name", label: "Name" },
        { key: "branch", label: "Branch" },
        { key: "type", label: "Leave type" },
        { key: "start", label: "From", kind: "date" },
        { key: "end", label: "To", kind: "date" },
        { key: "days", label: "Working days", kind: "number" },
        { key: "status", label: "Status" },
        { key: "requested", label: "Requested", kind: "datetime" },
      ],
      rows: rows.length ? [...rows, { ...totalRow(rows, "request_no", "Total", ["days"]), name: `${rows.length} requests` }] : [],
      notes: ["Requests are included if any part of the leave falls in the period. Days are the whole request's working days."],
    };
  },
};

const leaveBalances: ReportDefinition = {
  key: "leave-balances",
  title: "Leave balances",
  description: "Each current employee's entitlement, days taken, days pending and days left, by leave type, for the year.",
  basePath: "/hr",
  permission: "hr.read",
  dates: "asAt",
  branchFilter: true,
  async run(supabase, f) {
    const year = Number(f.to.slice(0, 4));
    const { branches } = await lookups(supabase);
    const employees = await fetchAll<Pick<EmployeeRow, "id" | "employee_no" | "first_name" | "last_name" | "branch_id">>((from, to) =>
      supabase
        .from("employees")
        .select("id, employee_no, first_name, last_name, branch_id")
        .in("status", ["probation", "active"])
        .order("last_name")
        .order("first_name")
        .order("id")
        .range(from, to),
    );
    const inScope = branchMatcher(f, branches);
    const chosen = employees.filter((e) => inScope(e.branch_id));

    type Balance = { name: string; uses_balance: boolean; entitlement: number; taken: number; pending: number; available: number | null };
    const balances = new Map<string, Balance[]>();
    // A few at a time, so a large branch doesn't open hundreds of connections at once.
    for (let i = 0; i < chosen.length; i += 10) {
      const batch = chosen.slice(i, i + 10);
      const results = await Promise.all(batch.map((e) => supabase.rpc("leave_balances", { p_employee_id: e.id, p_year: year })));
      results.forEach((r, j) => {
        if (r.error) throw dbFailure(r.error);
        balances.set(batch[j].id, r.data as Balance[]);
      });
    }

    const rows: Row[] = [];
    for (const e of chosen) {
      for (const b of balances.get(e.id) ?? []) {
        if (!b.uses_balance && b.taken === 0 && b.pending === 0) continue;
        rows.push({
          employee_no: e.employee_no,
          _href: employeeHref(e.id),
          name: `${e.first_name} ${e.last_name}`,
          branch: branches.get(e.branch_id)?.name,
          type: b.name,
          entitlement: b.uses_balance ? b.entitlement : null,
          taken: b.taken,
          pending: b.pending,
          available: b.available,
        });
      }
    }
    return {
      columns: [
        { key: "employee_no", label: "Employee no." },
        { key: "name", label: "Name" },
        { key: "branch", label: "Branch" },
        { key: "type", label: "Leave type" },
        { key: "entitlement", label: "Entitlement", kind: "number" },
        { key: "taken", label: "Taken", kind: "number" },
        { key: "pending", label: "Pending", kind: "number" },
        { key: "available", label: "Left", kind: "number" },
      ],
      rows,
      notes: [
        `Balances for ${year}, in working days. Days left take off both approved and pending requests.`,
        "Leave types that don't come out of a balance, such as unpaid leave, are shown only when some has been taken or requested.",
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

type PayrollLine = {
  id: string;
  employee_id: string;
  branch_id: string;
  department_code: string;
  days_paid: number;
  days_in_month: number;
  basic: string;
  housing: string;
  transport: string;
  medical: string;
  utility: string;
  other_allowance: string;
  commission: string;
  extra_taxable: string;
  extra_non_taxable: string;
  gross: string;
  pension_employee: string;
  pension_employer: string;
  nhf: string;
  annual_taxable: string;
  paye: string;
  deductions: string;
  net: string;
  bank_name: string | null;
  bank_account_number: string | null;
  pension_administrator: string | null;
  pension_pin: string | null;
  tax_id: string | null;
};

type Run = { id: string; period: string; status: "draft" | "submitted" | "approved" | "cancelled" };

const RUN_STATUS_LABELS: Record<Run["status"], string> = {
  draft: "a draft",
  submitted: "submitted and waiting for approval",
  approved: "approved",
  cancelled: "cancelled",
};

/** The month's payroll run (not cancelled) and its lines inside the branch filter, with names. */
async function loadPayroll(supabase: SupabaseClient, f: ReportFilters, approvedOnly: boolean) {
  const period = `${f.to.slice(0, 7)}-01`;
  const { data: run, error } = await supabase
    .from("payroll_runs")
    .select("id, period, status")
    .eq("period", period)
    .neq("status", "cancelled")
    .maybeSingle<Run>();
  if (error) throw dbFailure(error);
  const month = monthLabel(period);
  if (!run) return { lines: [], names: new Map<string, Person>(), notes: [`There is no payroll for ${month}.`], departments: new Map<string, string>(), branches: new Map<string, Branch>() };
  if (approvedOnly && run.status !== "approved") {
    return {
      lines: [],
      names: new Map<string, Person>(),
      notes: [`The payroll for ${month} is ${RUN_STATUS_LABELS[run.status]}. This report is available once it is approved.`],
      departments: new Map<string, string>(),
      branches: new Map<string, Branch>(),
    };
  }
  const [{ branches, departments }, lines] = await Promise.all([
    lookups(supabase),
    fetchAll<PayrollLine>((from, to) => supabase.from("payroll_lines").select("*").eq("run_id", run.id).order("id").range(from, to)),
  ]);
  const inScope = branchMatcher(f, branches);
  const chosen = lines.filter((l) => inScope(l.branch_id));
  const names = await people(supabase, chosen.map((l) => l.employee_id));
  const byName = (a: PayrollLine, b: PayrollLine) =>
    (names.get(a.employee_id)?.full_name ?? "").localeCompare(names.get(b.employee_id)?.full_name ?? "");
  return {
    lines: chosen.sort(byName),
    names,
    departments,
    branches,
    notes: [`Payroll for ${month}, ${RUN_STATUS_LABELS[run.status]}.`],
  };
}

const payrollRegister: ReportDefinition = {
  key: "payroll-register",
  title: "Payroll register",
  description: "Every employee's pay for the month of the chosen date: earnings, deductions and net pay.",
  basePath: "/hr",
  permission: "payroll.read",
  dates: "asAt",
  branchFilter: true,
  async run(supabase, f) {
    const { lines, names, departments, branches, notes } = await loadPayroll(supabase, f, false);
    const rows: Row[] = lines.map((l) => ({
      employee_no: names.get(l.employee_id)?.employee_no,
      name: names.get(l.employee_id)?.full_name ?? "Employee",
      branch: branches.get(l.branch_id)?.name,
      department: departments.get(l.department_code) ?? l.department_code,
      days: `${l.days_paid}/${l.days_in_month}`,
      basic: num(l.basic),
      housing: num(l.housing),
      transport: num(l.transport),
      other_allowances: round2(num(l.medical) + num(l.utility) + num(l.other_allowance)),
      commission: num(l.commission),
      other_pay: round2(num(l.extra_taxable) + num(l.extra_non_taxable)),
      gross: num(l.gross),
      pension: num(l.pension_employee),
      nhf: num(l.nhf),
      paye: num(l.paye),
      deductions: num(l.deductions),
      net: num(l.net),
    }));
    const money = ["basic", "housing", "transport", "other_allowances", "commission", "other_pay", "gross", "pension", "nhf", "paye", "deductions", "net"];
    return {
      columns: [
        { key: "employee_no", label: "Employee no." },
        { key: "name", label: "Name" },
        { key: "branch", label: "Branch" },
        { key: "department", label: "Department" },
        { key: "days", label: "Days paid" },
        { key: "basic", label: "Basic", kind: "money" },
        { key: "housing", label: "Housing", kind: "money" },
        { key: "transport", label: "Transport", kind: "money" },
        { key: "other_allowances", label: "Other allowances", kind: "money" },
        { key: "commission", label: "Commission", kind: "money" },
        { key: "other_pay", label: "Bonuses and other pay", kind: "money" },
        { key: "gross", label: "Gross", kind: "money" },
        { key: "pension", label: "Pension", kind: "money" },
        { key: "nhf", label: "NHF", kind: "money" },
        { key: "paye", label: "PAYE", kind: "money" },
        { key: "deductions", label: "Other deductions", kind: "money" },
        { key: "net", label: "Net pay", kind: "money" },
      ],
      rows: rows.length ? [...rows, { ...totalRow(rows, "employee_no", "Total", money), name: `${rows.length} employees` }] : [],
      notes: [...notes, "Pension is the employee's contribution; the employer's contribution is on the statutory deductions report."],
    };
  },
};

const bankSchedule: ReportDefinition = {
  key: "bank-payment-schedule",
  title: "Bank payment schedule",
  description: "Net pay for the approved payroll of the chosen month, with each employee's bank and account number.",
  basePath: "/hr",
  permission: "payroll.read",
  dates: "asAt",
  branchFilter: true,
  async run(supabase, f) {
    const { lines, names, branches, notes } = await loadPayroll(supabase, f, true);
    const paid = lines.filter((l) => num(l.net) > 0);
    const rows: Row[] = paid.map((l) => ({
      employee_no: names.get(l.employee_id)?.employee_no,
      name: names.get(l.employee_id)?.full_name ?? "Employee",
      branch: branches.get(l.branch_id)?.name,
      bank: l.bank_name ?? "Missing",
      account: l.bank_account_number ?? "Missing",
      net: num(l.net),
    }));
    const missing = paid.filter((l) => !l.bank_name || !l.bank_account_number).length;
    return {
      columns: [
        { key: "employee_no", label: "Employee no." },
        { key: "name", label: "Name" },
        { key: "branch", label: "Branch" },
        { key: "bank", label: "Bank" },
        { key: "account", label: "Account number" },
        { key: "net", label: "Net pay", kind: "money" },
      ],
      rows: rows.length ? [...rows, { ...totalRow(rows, "employee_no", "Total", ["net"]), name: `${rows.length} payments` }] : [],
      notes: [
        ...notes,
        ...(missing ? [`${missing} ${missing === 1 ? "employee has" : "employees have"} no bank details. Add them on the employee record before paying.`] : []),
        "Bank details are as they were when the payroll was worked out.",
      ],
    };
  },
};

const STATUTORY: Record<string, string> = { paye: "PAYE", pension: "Pension", nhf: "NHF" };

const statutoryDeductions: ReportDefinition = {
  key: "statutory-deductions",
  title: "Statutory deductions",
  description: "PAYE, pension or NHF for the approved payroll of the chosen month, with the details needed to remit them.",
  basePath: "/hr",
  permission: "payroll.read",
  dates: "asAt",
  branchFilter: true,
  options: [
    {
      name: "kind",
      label: "Deduction",
      choices: Object.entries(STATUTORY).map(([value, label]) => ({ value, label })),
    },
  ],
  async run(supabase, f) {
    const { lines, names, branches, notes } = await loadPayroll(supabase, f, true);
    const who = (l: PayrollLine) => ({
      employee_no: names.get(l.employee_id)?.employee_no,
      name: names.get(l.employee_id)?.full_name ?? "Employee",
      branch: branches.get(l.branch_id)?.name,
    });
    const base: Column[] = [
      { key: "employee_no", label: "Employee no." },
      { key: "name", label: "Name" },
      { key: "branch", label: "Branch" },
    ];
    let columns: Column[];
    let rows: Row[];
    let money: string[];
    let missing: number;

    if (f.options.kind === "pension") {
      const chosen = lines.filter((l) => num(l.pension_employee) + num(l.pension_employer) > 0);
      rows = chosen.map((l) => ({
        ...who(l),
        pfa: l.pension_administrator ?? "Missing",
        pin: l.pension_pin ?? "Missing",
        employee: num(l.pension_employee),
        employer: num(l.pension_employer),
        total: round2(num(l.pension_employee) + num(l.pension_employer)),
      }));
      columns = [
        ...base,
        { key: "pfa", label: "Pension administrator" },
        { key: "pin", label: "PIN" },
        { key: "employee", label: "Employee", kind: "money" },
        { key: "employer", label: "Employer", kind: "money" },
        { key: "total", label: "Total", kind: "money" },
      ];
      money = ["employee", "employer", "total"];
      missing = chosen.filter((l) => !l.pension_administrator || !l.pension_pin).length;
    } else if (f.options.kind === "nhf") {
      const chosen = lines.filter((l) => num(l.nhf) > 0);
      rows = chosen.map((l) => ({ ...who(l), basic: num(l.basic), nhf: num(l.nhf) }));
      columns = [...base, { key: "basic", label: "Basic pay", kind: "money" }, { key: "nhf", label: "NHF", kind: "money" }];
      money = ["basic", "nhf"];
      missing = 0;
    } else {
      const chosen = lines.filter((l) => num(l.paye) > 0);
      rows = chosen.map((l) => ({ ...who(l), tin: l.tax_id ?? "Missing", gross: num(l.gross), paye: num(l.paye) }));
      columns = [...base, { key: "tin", label: "TIN" }, { key: "gross", label: "Gross pay", kind: "money" }, { key: "paye", label: "PAYE", kind: "money" }];
      money = ["gross", "paye"];
      missing = chosen.filter((l) => !l.tax_id).length;
    }

    const label = STATUTORY[f.options.kind] ?? "PAYE";
    return {
      columns,
      rows: rows.length ? [...rows, { ...totalRow(rows, "employee_no", "Total", money), name: `${rows.length} employees` }] : [],
      notes: [
        ...notes,
        ...(missing
          ? [`${missing} ${missing === 1 ? "employee is" : "employees are"} missing ${f.options.kind === "pension" ? "a pension administrator or PIN" : "a TIN"}.`]
          : []),
        `Only employees with ${label} this month are listed. Details are as they were when the payroll was worked out.`,
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Training and commission
// ---------------------------------------------------------------------------

const ENROLMENT_STATUSES: Record<string, string> = {
  enrolled: "Enrolled",
  completed: "Completed",
  no_show: "Didn't attend",
  withdrawn: "Withdrew",
};

const trainingRegister: ReportDefinition = {
  key: "training-register",
  title: "Training register",
  description: "Training that ran in the period, who attended, and their hours, scores and results.",
  basePath: "/hr",
  permission: "hr.read",
  dates: "period",
  branchFilter: true,
  async run(supabase, f) {
    type Training = { id: string; title: string; trainer: string | null; starts_on: string; ends_on: string; status: string };
    type Enrolment = {
      training_id: string;
      employee_id: string;
      status: string;
      hours_attended: string | null;
      score: string | null;
      passed: boolean | null;
    };
    const { branches } = await lookups(supabase);
    const { data, error } = await supabase
      .from("trainings")
      .select("id, title, trainer, starts_on, ends_on, status")
      .lte("starts_on", f.to)
      .gte("ends_on", f.from)
      .neq("status", "cancelled")
      .order("starts_on");
    if (error) throw dbFailure(error);
    const trainings = data as Training[];
    const enrolments = trainings.length
      ? await fetchAll<Enrolment>((from, to) =>
          supabase
            .from("training_enrollments")
            .select("training_id, employee_id, status, hours_attended, score, passed")
            .in(
              "training_id",
              trainings.map((t) => t.id),
            )
            .order("id")
            .range(from, to),
        )
      : [];
    const names = await people(supabase, enrolments.map((e) => e.employee_id));
    const inScope = branchMatcher(f, branches);

    const rows: Row[] = [];
    for (const t of trainings) {
      const attendees = enrolments
        .filter((e) => e.training_id === t.id && inScope(names.get(e.employee_id)?.branch_id))
        .sort((a, b) => (names.get(a.employee_id)?.full_name ?? "").localeCompare(names.get(b.employee_id)?.full_name ?? ""));
      if (!attendees.length) continue;
      rows.push({ training: `${t.title}${t.trainer ? ` (${t.trainer})` : ""}`, _kind: "heading", starts: t.starts_on, ends: t.ends_on });
      for (const e of attendees) {
        const p = names.get(e.employee_id);
        rows.push({
          training: p?.full_name ?? "Employee",
          employee_no: p?.employee_no,
          branch: p ? branches.get(p.branch_id)?.name : null,
          status: ENROLMENT_STATUSES[e.status] ?? e.status,
          hours: e.hours_attended === null ? null : num(e.hours_attended),
          score: e.score === null ? null : num(e.score),
          result: e.passed === null ? null : e.passed ? "Passed" : "Not passed",
        });
      }
    }
    return {
      columns: [
        { key: "training", label: "Training and attendee" },
        { key: "starts", label: "Starts", kind: "date" },
        { key: "ends", label: "Ends", kind: "date" },
        { key: "employee_no", label: "Employee no." },
        { key: "branch", label: "Branch" },
        { key: "status", label: "Attendance" },
        { key: "hours", label: "Hours", kind: "number" },
        { key: "score", label: "Score", kind: "number" },
        { key: "result", label: "Result" },
      ],
      rows,
      notes: ["Training that overlaps the period is included. Cancelled training is left out."],
    };
  },
};

const commissionSummary: ReportDefinition = {
  key: "commission-summary",
  title: "Commission summary",
  description: "Targets closed in the period: target, approved sales, commission earned and whether it has been paid.",
  basePath: "/hr",
  permission: "hr.read",
  dates: "period",
  branchFilter: true,
  async run(supabase, f) {
    type Target = {
      id: string;
      employee_id: string;
      name: string;
      period_start: string;
      period_end: string;
      target_amount: string;
      status: TargetStatus;
      achieved: string | null;
      commission: string | null;
      payout_id: string | null;
    };
    const { branches } = await lookups(supabase);
    const targets = await fetchAll<Target>((from, to) =>
      supabase
        .from("commission_targets")
        .select("id, employee_id, name, period_start, period_end, target_amount, status, achieved, commission, payout_id")
        .eq("status", "closed")
        .gte("closed_at", f.from)
        .lt("closed_at", nextDay(f.to))
        .order("closed_at")
        .range(from, to),
    );
    const [names, payouts] = await Promise.all([
      people(supabase, targets.map((t) => t.employee_id)),
      (async () => {
        const ids = targets.map((t) => t.payout_id).filter((id): id is string => Boolean(id));
        if (!ids.length) return new Map<string, PayoutStatus>();
        const { data, error } = await supabase.from("commission_payouts").select("id, status").in("id", ids);
        if (error) throw dbFailure(error);
        return new Map((data as { id: string; status: PayoutStatus }[]).map((p) => [p.id, p.status]));
      })(),
    ]);
    const inScope = branchMatcher(f, branches);
    const rows: Row[] = targets
      .filter((t) => inScope(names.get(t.employee_id)?.branch_id))
      .map((t) => {
        const p = names.get(t.employee_id);
        const payout = t.payout_id ? payouts.get(t.payout_id) : undefined;
        return {
          name: p?.full_name ?? "Employee",
          _href: `/hr/commissions/${t.id}`,
          employee_no: p?.employee_no,
          branch: p ? branches.get(p.branch_id)?.name : null,
          target_name: t.name,
          period: `${t.period_start} to ${t.period_end}`,
          target: num(t.target_amount),
          achieved: num(t.achieved),
          percent: num(t.target_amount) > 0 ? Math.round((num(t.achieved) / num(t.target_amount)) * 1000) / 10 : null,
          commission: num(t.commission),
          paid: num(t.commission) === 0 ? "Nothing to pay" : payout ? PAYOUT_STATUSES[payout].label : "Sent to payroll",
        };
      });
    return {
      columns: [
        { key: "name", label: "Employee" },
        { key: "employee_no", label: "Employee no." },
        { key: "branch", label: "Branch" },
        { key: "target_name", label: "Target" },
        { key: "period", label: "Period" },
        { key: "target", label: "Target amount", kind: "money" },
        { key: "achieved", label: "Approved sales", kind: "money" },
        { key: "percent", label: "% of target", kind: "number" },
        { key: "commission", label: "Commission", kind: "money" },
        { key: "paid", label: "Payment" },
      ],
      rows: rows.length ? [...rows, { ...totalRow(rows, "name", "Total", ["target", "achieved", "commission"]), target_name: `${rows.length} targets` }] : [],
      notes: ["Targets are listed by the date they were closed. Commission is paid with the first payroll after closing."],
    };
  },
};

export const hrReports: ReportDefinition[] = [
  staffRegister,
  headcount,
  leaveRegister,
  leaveBalances,
  payrollRegister,
  bankSchedule,
  statutoryDeductions,
  trainingRegister,
  commissionSummary,
];
