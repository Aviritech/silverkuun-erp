import type { InterestMethod, RateBasis, RepaymentFrequency } from "./constants";

/** A preview of the repayment schedule as the application is filled in. Mirrors public.loan_schedule(). */
export type ScheduleTerms = {
  principal: number;
  interestRate: number;
  rateBasis: RateBasis;
  interestMethod: InterestMethod;
  frequency: RepaymentFrequency;
  tenorMonths: number;
  start: string;
  firstDue?: string | null;
};

export type ScheduleLine = { installment_no: number; due_date: string; principal_due: number; interest_due: number };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function periods(frequency: RepaymentFrequency, tenorMonths: number): number {
  switch (frequency) {
    case "monthly":
      return tenorMonths;
    case "quarterly":
      return Math.ceil(tenorMonths / 3);
    case "weekly":
      return Math.max(1, Math.round((tenorMonths * 52) / 12));
    default:
      return 1;
  }
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Instalment k (from 1) counted from an anchor that is itself instalment 1. */
function dueFrom(frequency: RepaymentFrequency, anchor: string, k: number): string {
  if (frequency === "weekly") return addDays(anchor, 7 * (k - 1));
  if (frequency === "monthly") return addMonths(anchor, k - 1);
  if (frequency === "quarterly") return addMonths(anchor, 3 * (k - 1));
  return anchor;
}

export function loanSchedule(t: ScheduleTerms): ScheduleLine[] {
  if (!(t.principal > 0) || !(t.tenorMonths >= 1)) return [];
  const n = periods(t.frequency, t.tenorMonths);
  const annual = (t.rateBasis === "per_month" ? t.interestRate * 12 : t.interestRate) / 100;
  const perYear = t.frequency === "weekly" ? 52 : t.frequency === "quarterly" ? 4 : 12;
  const r = annual / perYear;
  const defaultFirst =
    t.frequency === "weekly"
      ? addDays(t.start, 7)
      : t.frequency === "monthly"
        ? addMonths(t.start, 1)
        : t.frequency === "quarterly"
          ? addMonths(t.start, 3)
          : addMonths(t.start, t.tenorMonths);
  const first = t.firstDue || defaultFirst;
  const due = (k: number) =>
    !t.firstDue && t.frequency !== "end_of_term" ? dueFrom(t.frequency, t.start, k + 1) : dueFrom(t.frequency, first, k);

  const lines: ScheduleLine[] = [];
  if (t.interestMethod === "reducing_balance" && t.frequency !== "end_of_term" && r > 0) {
    const payment = round2((t.principal * r) / (1 - Math.pow(1 + r, -n)));
    let balance = t.principal;
    for (let k = 1; k <= n; k++) {
      const interest = round2(balance * r);
      const principal = k === n ? round2(balance) : Math.min(balance, round2(payment - interest));
      balance = round2(balance - principal);
      lines.push({ installment_no: k, due_date: due(k), principal_due: principal, interest_due: interest });
    }
    return lines;
  }
  const totalInterest = round2((t.principal * annual * t.tenorMonths) / 12);
  const p = round2(t.principal / n);
  const i = round2(totalInterest / n);
  for (let k = 1; k <= n; k++) {
    lines.push({
      installment_no: k,
      due_date: due(k),
      principal_due: k < n ? p : round2(t.principal - p * (n - 1)),
      interest_due: k < n ? i : round2(totalInterest - i * (n - 1)),
    });
  }
  return lines;
}
