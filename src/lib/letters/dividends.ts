import { addMonths, monthlyRate, monthsBetween } from "./words";

export type DividendContribution = { amount: number | string; paid_on: string };

export type DividendPeriod = {
  no: number;
  /** The period runs from the day after `from` to `to`, both calendar dates. */
  from: string;
  to: string;
  /** Contributions that completed a full month in this period. */
  balance: number;
  /** Monthly rate, in percent. */
  rate: number;
  dividend: number;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A part month counts as a full month once a contribution has been held this many days into it (Kuun, 2026-11-19). */
export const FULL_MONTH_DAYS = 21;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);

/**
 * The Plan Tenure and Dividend Statement's breakdown, one period per month of the plan.
 *
 * Same rule as plan_accrued_dividends() in the database: each verified contribution earns the plan's monthly rate for
 * every full month it is held, up to the maturity date. Kuun's rule (2026-11-19): a month held for 21 days or more
 * counts as a full month, and a shorter part month earns nothing. A month earned is shown in the period it completes
 * in; a counted part month is shown in the period the date falls in.
 */
export function dividendStatement(
  plan: { start_date: string; maturity_date: string; interest_rate: number | string },
  contributions: DividendContribution[],
  asOf?: string,
): { periods: DividendPeriod[]; totalContributions: number; totalDividends: number } {
  const end = asOf && asOf < plan.maturity_date ? asOf : plan.maturity_date;
  const count = Math.max(1, monthsBetween(plan.start_date, plan.maturity_date));
  const rate = monthlyRate(plan.interest_rate);
  const bounds = Array.from({ length: count + 1 }, (_, k) => (k === count ? plan.maturity_date : addMonths(plan.start_date, k)));
  const balances = new Array<number>(count).fill(0);

  const held = contributions.filter((c) => c.paid_on.slice(0, 10) <= end);
  for (const c of held) {
    const amount = Number(c.amount);
    const credit = (date: string) => {
      // The period whose end is the first boundary on or after the date.
      let k = bounds.findIndex((b, i) => i > 0 && b >= date);
      if (k === -1) k = count;
      balances[k - 1] += amount;
    };
    let j = 1;
    for (; ; j++) {
      const completed = addMonths(c.paid_on, j);
      if (completed > end) break;
      credit(completed);
    }
    // The month still running counts once it has been held for 21 days.
    if (daysBetween(addMonths(c.paid_on, j - 1), end) >= FULL_MONTH_DAYS) credit(end);
  }

  const periods = balances.map((balance, i) => ({
    no: i + 1,
    from: bounds[i],
    to: bounds[i + 1],
    balance: round2(balance),
    rate,
    dividend: round2((balance * rate) / 100),
  }));
  return {
    periods,
    totalContributions: round2(held.reduce((s, c) => s + Number(c.amount), 0)),
    totalDividends: round2(periods.reduce((s, p) => s + p.dividend, 0)),
  };
}
