import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Letter } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { monthlyRate, nextPayDay, tenureWords } from "@/lib/letters/words";
import { FREQUENCIES } from "@/modules/administration/constants";
import { getPlanLetter, interestPayDay, letterName } from "@/modules/administration/letters";
import { administrationModule } from "@/modules/administration/module";
import { accountLine, DepositLetter } from "../../../deposit-letter";

export const metadata: Metadata = { title: "Agreement letter · Silverkuun ERP" };

/**
 * The membership agreement letter for a plan, from the "Roll-over membership agreement letter" sample in the library.
 * ?rollover=1 words it as a roll-over of an earlier deposit, as the sample is.
 */
export default async function PlanAgreementLetter({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rollover?: string }>;
}) {
  await requireModule(administrationModule);
  const { id } = await params;
  const { rollover } = await searchParams;
  const data = await getPlanLetter(id);
  if (!data || data.member.status !== "approved" || data.plan.status === "cancelled") notFound();
  const { plan, member, manager } = data;
  const isRollover = rollover === "1";
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
      title={`${isRollover ? "Roll-over" : "Membership"} agreement letter · ${name}`}
      date={plan.start_date}
      backHref={`/administration/members/${member.id}?tab=plans`}
      backLabel="Back to the member's plans"
      gaps={gaps}
      notes={
        <>
          {data.planName} plan, dated the day it started. Print it or save it as a PDF, have it signed and stamped, then
          upload the signed copy on the member&apos;s file as a &quot;Signed agreement letter&quot;.{" "}
          <Link href={`/letters/plans/${plan.id}/agreement${isRollover ? "" : "?rollover=1"}`} className="underline">
            {isRollover ? "Word it as a new deposit" : "Word it as a roll-over"}
          </Link>
        </>
      }
    >
      <DepositLetter
        kind={isRollover ? "rollover" : "new"}
        name={name}
        membershipNo={member.membership_no}
        address={member.address}
        headingAmount={Number(plan.contribution_amount)}
        deposit={Number(plan.contribution_amount)}
        frequency={
          plan.contribution_frequency === "one_off"
            ? null
            : (FREQUENCIES[plan.contribution_frequency as keyof typeof FREQUENCIES]?.toLowerCase() ?? null)
        }
        tenure={tenureWords(plan.start_date, plan.maturity_date)}
        rate={monthlyRate(plan.interest_rate)}
        dividendsAtMaturity={plan.dividends_at_maturity}
        maturityDate={plan.maturity_date}
        payDay={payDay}
        firstPay={payDay ? nextPayDay(plan.start_date, payDay) : null}
        account={account}
        manager={manager}
      />
    </Letter>
  );
}
