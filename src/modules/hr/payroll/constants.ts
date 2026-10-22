export const RUN_STATUSES = {
  draft: { label: "Draft", tone: "amber" },
  submitted: { label: "Waiting for approval", tone: "blue" },
  approved: { label: "Approved", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
} as const;
export type RunStatus = keyof typeof RUN_STATUSES;

export const SALARY_STATUSES = {
  pending: { label: "Waiting for approval", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
} as const;
export type SalaryStatus = keyof typeof SALARY_STATUSES;

/** The parts of a monthly salary, in payslip order. Mirrors employee_salaries. */
export const SALARY_COMPONENTS = {
  basic: "Basic",
  housing: "Housing",
  transport: "Transport",
  medical: "Medical",
  utility: "Utility",
  other_allowance: "Other allowance",
} as const;
export type SalaryComponent = keyof typeof SALARY_COMPONENTS;
export const COMPONENT_KEYS = Object.keys(SALARY_COMPONENTS) as SalaryComponent[];

export const DEDUCTION_KINDS = {
  salary_advance: "Salary advance",
  staff_loan: "Staff loan",
  cooperative: "Cooperative",
  union_dues: "Union dues",
  other: "Other",
} as const;
export type DeductionKind = keyof typeof DEDUCTION_KINDS;

export const ADJUSTMENT_KINDS = {
  bonus: "Bonus",
  overtime: "Overtime",
  arrears: "Arrears",
  allowance: "One-off allowance",
  deduction: "One-off deduction",
} as const;
export type AdjustmentKind = keyof typeof ADJUSTMENT_KINDS;

/** Labels for one-off deductions on the payslip as well as recurring ones. */
export const LINE_DEDUCTION_KINDS: Record<string, string> = { ...DEDUCTION_KINDS, deduction: "One-off deduction" };

/** "2026-03-01" → "March 2026". */
export function monthLabel(period: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${period.slice(0, 7)}-01T00:00:00Z`),
  );
}

/** The first of the current month, as YYYY-MM-01. */
export function thisMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export function salaryTotal(s: Record<SalaryComponent, number | string>): number {
  return COMPONENT_KEYS.reduce((sum, k) => sum + Number(s[k] ?? 0), 0);
}
