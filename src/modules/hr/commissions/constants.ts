import { formatMoney } from "@/lib/format";

/** How commission is worked out on a target. Mirrors commission_targets.method. */
export const COMMISSION_METHODS = {
  percent_of_sales: "A percentage of every approved sale",
  percent_of_target_if_met: "A percentage of the target, once it is met",
  flat_if_met: "A fixed amount, once the target is met",
  tiered: "Rising rates in bands of sales",
} as const;
export type CommissionMethod = keyof typeof COMMISSION_METHODS;

export const TARGET_STATUSES = {
  open: { label: "Open", tone: "blue" },
  closed: { label: "Closed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
} as const;
export type TargetStatus = keyof typeof TARGET_STATUSES;

export const SALE_STATUSES = {
  pending: { label: "Waiting for approval", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
} as const;
export type SaleStatus = keyof typeof SALE_STATUSES;

export const PAYOUT_STATUSES = {
  approved: { label: "Waiting for the next payroll", tone: "amber" },
  paid: { label: "Paid with salary", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
} as const;
export type PayoutStatus = keyof typeof PAYOUT_STATUSES;

export type Tier = { upto: number | null; rate: number };

export type TargetTerms = {
  method: CommissionMethod;
  target_amount: number | string;
  rate: number | string | null;
  flat_amount: number | string | null;
  tiers: Tier[] | null;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number | string | null) => `${Number(v ?? 0).toLocaleString("en-NG", { maximumFractionDigits: 3 })}%`;

/**
 * Commission earned on sales of `achieved`, worked out the way the database does when the target is closed
 * (app.commission_for). Used for the "so far" figure; the database's figure is the one paid.
 */
export function commissionFor(terms: TargetTerms, achieved: number): number {
  const target = Number(terms.target_amount);
  switch (terms.method) {
    case "percent_of_sales":
      return round2((achieved * Number(terms.rate ?? 0)) / 100);
    case "percent_of_target_if_met":
      return achieved >= target ? round2((target * Number(terms.rate ?? 0)) / 100) : 0;
    case "flat_if_met":
      return achieved >= target ? Number(terms.flat_amount ?? 0) : 0;
    case "tiered": {
      if (achieved <= 0) return 0;
      let lower = 0;
      let total = 0;
      for (const tier of terms.tiers ?? []) {
        const upper = tier.upto === null ? achieved : Number(tier.upto);
        total += (Math.max(0, Math.min(achieved, upper) - lower) * Number(tier.rate)) / 100;
        if (tier.upto === null || achieved <= upper) break;
        lower = upper;
      }
      return round2(total);
    }
  }
}

/** The terms in words, for the target page and the employee's own view. */
export function describeTerms(terms: TargetTerms): string[] {
  const target = formatMoney(terms.target_amount);
  switch (terms.method) {
    case "percent_of_sales":
      return [`${pct(terms.rate)} of every approved sale in the period, whether or not the ${target} target is met.`];
    case "percent_of_target_if_met":
      return [`${pct(terms.rate)} of the ${target} target, paid only if approved sales reach the target.`];
    case "flat_if_met":
      return [`${formatMoney(terms.flat_amount)}, paid only if approved sales reach the ${target} target.`];
    case "tiered": {
      const lines: string[] = [];
      let lower = 0;
      for (const tier of terms.tiers ?? []) {
        lines.push(
          tier.upto === null
            ? `${pct(tier.rate)} on sales above ${formatMoney(lower)}`
            : `${pct(tier.rate)} on sales from ${formatMoney(lower)} up to ${formatMoney(tier.upto)}`,
        );
        if (tier.upto === null) break;
        lower = Number(tier.upto);
      }
      return [`Each band of approved sales earns its own rate, like tax bands (target ${target}):`, ...lines];
    }
  }
}
