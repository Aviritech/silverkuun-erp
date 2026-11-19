import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Letter } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import { monthlyRate, naira, nextPayDay, tenureWords } from "@/lib/letters/words";
import { createClient } from "@/lib/supabase/server";
import { getPlanLetter, interestPayDay, letterName, standingContributions } from "@/modules/administration/letters";
import { administrationModule } from "@/modules/administration/module";
import type { Contribution } from "@/modules/administration/queries";
import { accountLine, DepositLetter } from "../../deposit-letter";

export const metadata: Metadata = { title: "Top-up letter · Silverkuun ERP" };

/**
 * The top-up membership agreement letter, from the "Top-up membership agreement letter" sample in the library: the
 * heading names the top-up, and the body confirms the whole deposit after it, for the time left to maturity, and the
 * monthly interest on that.
 */
export default async function TopUpLetter({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(administrationModule);
  const { id } = await params;
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("contributions").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  const topUp = row as Contribution | null;
  if (!topUp || topUp.kind !== "top_up") notFound();

  // The letter goes out only once the Receipts Confirmation Accountant has confirmed the money (Kuun, 2026-11-19).
  const { data: confirmed, error: confirmedError } = await supabase.rpc("member_confirmed_contributions", { p_member_id: topUp.member_id });
  if (confirmedError) throw dbFailure(confirmedError);
  if (!((confirmed ?? []) as { contribution_id: string }[]).some((r) => r.contribution_id === topUp.id)) notFound();

  const data = await getPlanLetter(topUp.member_plan_id);
  if (!data || data.member.status !== "approved") notFound();
  const { plan, member, manager } = data;
  const standing = standingContributions(data.contributions);
  if (!standing.some((c) => c.id === topUp.id)) notFound(); // reversed

  // The deposit after the top-up: everything still standing that was paid up to and including it.
  const upTo = (c: Contribution) =>
    c.paid_on < topUp.paid_on || (c.paid_on === topUp.paid_on && c.recorded_at <= topUp.recorded_at);
  const deposit = standing.filter(upTo).reduce((s, c) => s + Number(c.amount), 0);
  const name = letterName(member);
  const payDay = interestPayDay(plan, member);
  const account = accountLine(member, name);

  const gaps = [
    !member.membership_no && "The member's membership number",
    !plan.dividends_at_maturity && !payDay && "The day of the month interest is paid",
    !account && "The member's bank account (on the member's details)",
    !manager && "A Branch Manager for this branch, to sign the letter",
  ].filter((g): g is string => Boolean(g));

  return (
    <Letter
      title={`Top-up agreement letter · ${name}`}
      date={topUp.paid_on}
      backHref={`/administration/members/${member.id}?tab=plans`}
      backLabel="Back to the member's plans"
      gaps={gaps}
      notes={
        <>
          Top-up of {naira(topUp.amount)} to the {data.planName} plan, paid {formatDate(topUp.paid_on)}
          {topUp.verified_at ? "" : " (not verified yet)"}. The letter confirms the plan&apos;s total after the top-up, for
          the time left to maturity. Upload the signed copy as a &quot;Signed agreement letter&quot;.
        </>
      }
    >
      <DepositLetter
        kind="top_up"
        name={name}
        membershipNo={member.membership_no}
        address={member.address}
        headingAmount={Number(topUp.amount)}
        deposit={deposit}
        frequency={null}
        tenure={tenureWords(topUp.paid_on, plan.maturity_date)}
        rate={monthlyRate(plan.interest_rate)}
        dividendsAtMaturity={plan.dividends_at_maturity}
        maturityDate={plan.maturity_date}
        payDay={payDay}
        firstPay={payDay ? nextPayDay(topUp.paid_on, payDay) : null}
        account={account}
        manager={manager}
      />
    </Letter>
  );
}
