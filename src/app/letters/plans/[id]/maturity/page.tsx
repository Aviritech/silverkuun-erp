import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddressBlock, Blank, Letter, LetterDate, SignOff } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { dividendStatement } from "@/lib/letters/dividends";
import { SOCIETY } from "@/lib/letters/letterhead";
import { naira, nairaInWords, percent, tenureWords } from "@/lib/letters/words";
import { today } from "@/lib/reports/filters";
import { administrationModule } from "@/modules/administration/module";
import { getPlanLetter, letterName, standingContributions } from "@/modules/administration/letters";
import { accountLine } from "../../../deposit-letter";

export const metadata: Metadata = { title: "Maturity letter · Silverkuun ERP" };

function Row({ label, children, strong = false }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <tr className={strong ? "font-bold" : undefined}>
      <td className="border border-neutral-400 px-2 py-1">{label}</td>
      <td className="border border-neutral-400 px-2 py-1 text-right tabular-nums">{children}</td>
    </tr>
  );
}

/**
 * The maturity letter, generated like the other letters (Kuun, 2026-11-19) instead of being written outside the system
 * and uploaded. It tells the member the plan has matured (or the date it will), what they put in, the dividends earned
 * and what is due, and their choices: for most plans the dividends were paid monthly and the capital is rolled over or
 * paid out; for Target savings the member rolls over the capital only, or the capital and earnings.
 */
export default async function MaturityLetter({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(administrationModule);
  const { id } = await params;
  const data = await getPlanLetter(id);
  if (!data || data.member.status !== "approved" || data.plan.status === "cancelled") notFound();
  const { plan, member, manager } = data;

  const issued = today();
  const matured = issued >= plan.maturity_date;
  const verified = standingContributions(data.contributions).filter((c) => c.verified_at);
  const s = dividendStatement(plan, verified);
  const paidMonthly = plan.dividends_at_maturity ? 0 : s.totalDividends;
  const due = s.totalContributions + s.totalDividends - paidMonthly;
  const name = letterName(member);
  const account = accountLine(member, name);
  const target = plan.plan_type === "target";

  const gaps = [
    !member.membership_no && "The member's membership number",
    !account && "The member's bank account (on the member's details)",
    !manager && "A Branch Manager for this branch, to sign the letter",
  ].filter((g): g is string => Boolean(g));

  return (
    <Letter
      title={`Maturity letter · ${name}`}
      date={issued}
      backHref={`/administration/members/${member.id}?tab=plans`}
      backLabel="Back to the member's plans"
      gaps={gaps}
      notes={
        <>
          {data.planName} plan{matured ? ", matured" : ", maturing"} on {formatDate(plan.maturity_date)}. Counts verified contributions only.
          Print it or save it as a PDF, have it signed and stamped, then upload the signed copy on the member&apos;s file as a
          &quot;Maturity and liquidation letter&quot;.
        </>
      }
    >
      <AddressBlock address={member.address} />

      <div className="mt-3 font-semibold uppercase">
        <p>DEAR {name}</p>
        <p>
          {matured ? "MATURITY" : "NOTICE OF MATURITY"} OF YOUR {data.planName} PLAN OF {tenureWords(plan.start_date, plan.maturity_date)}{" "}
          WITH MEMBERSHIP NUMBER <Blank width="w-28">{member.membership_no}</Blank>
        </p>
      </div>

      <p className="mt-3 text-justify">
        We write to inform you that your {data.planName} plan, which started on <LetterDate date={plan.start_date} />,{" "}
        {matured ? "matured" : "will mature"} on <LetterDate date={plan.maturity_date} />. A summary of the plan is below.
      </p>

      <table className="mt-3 w-full border-collapse text-[9.5pt]">
        <tbody>
          <Row label="Total contributions (capital)">{naira(s.totalContributions)}</Row>
          <Row label="Dividend rate">{percent(s.periods[0]?.rate ?? 0)} monthly</Row>
          <Row label="Dividends earned over the tenure">{naira(s.totalDividends)}</Row>
          {!plan.dividends_at_maturity && <Row label="Less: dividends already paid to you monthly">{naira(paidMonthly)}</Row>}
          <Row label="Amount due at maturity" strong>
            {naira(due)}
          </Row>
        </tbody>
      </table>
      <p className="mt-1 text-[9pt]">
        Amount due in words: <strong>{nairaInWords(due)}</strong>
      </p>

      <ol className="mt-3 list-decimal space-y-1.5 pl-[12mm] pr-2 text-justify">
        {target ? (
          <li>
            Your dividends have built up over the tenure and are due with your capital. You may roll over the capital only and
            have the dividends of {naira(s.totalDividends)} paid to you, or roll over the capital and the dividends together into
            a new plan.
          </li>
        ) : (
          <li>
            Your dividends have been paid to you monthly over the tenure. Your capital of {naira(s.totalContributions)} will be
            rolled over into a new plan on the same terms unless you instruct us otherwise.
          </li>
        )}
        <li>
          If you would rather be paid, the amount will be paid into your account{" "}
          <strong>({account ?? <Blank width="w-56" />})</strong> once you instruct us.
        </li>
        <li>
          Kindly inform the management {SOCIETY.liquidationNoticeWeeks} weeks before the time of liquidating, as agreed in your
          membership agreement.
        </li>
      </ol>

      <SignOff manager={manager} />
    </Letter>
  );
}
