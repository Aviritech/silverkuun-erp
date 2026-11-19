import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { FREQUENCIES } from "../constants";
import type { Liquidation } from "../queries";

/**
 * A part payout's new plan: the instructions while the request is open, and the plan the rest moved into once paid.
 * Renders nothing for a request that pays out the whole savings.
 */
export function NewPlanSummary({ l, memberLink = true }: { l: Liquidation; memberLink?: boolean }) {
  if (!l.new_plan_type) return null;
  const rest = l.rollover_amount ?? String(Math.max(0, Number(l.current_savings) - Number(l.amount)));
  const freq = FREQUENCIES[l.new_contribution_frequency as keyof typeof FREQUENCIES] ?? l.new_contribution_frequency;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
      <p className="font-medium">
        Part payout: the whole plan is liquidated and {formatMoney(rest)} {l.rollover_amount ? "moved" : "moves"} into a new{" "}
        {l.new_plan_name} plan
      </p>
      <p className="mt-0.5 text-xs text-zinc-600">
        {[
          l.new_plan_rate && `${Number(l.new_plan_rate) / 12}% a month`,
          `${formatMoney(l.new_contribution_amount)} ${String(freq).toLowerCase()}`,
          `${l.new_tenure_months} months from the day the payout posts`,
          l.new_interest_pay_day ? `interest paid on day ${l.new_interest_pay_day}` : "dividends paid at maturity",
        ]
          .filter(Boolean)
          .join(" · ")}
        {l.new_member_plan_id && memberLink && (
          <>
            {" · "}
            <Link href={`/administration/members/${l.member_id}?tab=plans`} className="underline">
              See the new plan
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
