import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Letter, SignOff } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { dividendStatement } from "@/lib/letters/dividends";
import { naira, percent, tenureWords } from "@/lib/letters/words";
import { today } from "@/lib/reports/filters";
import { administrationModule } from "@/modules/administration/module";
import { getPlanLetter, letterName, standingContributions } from "@/modules/administration/letters";

export const metadata: Metadata = { title: "Plan tenure and dividend statement · Silverkuun ERP" };

function Row({ label, children, strong = false }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <tr className={strong ? "font-bold" : undefined}>
      <td className="border border-neutral-400 px-2 py-1">{label}</td>
      <td className="border border-neutral-400 px-2 py-1 text-right tabular-nums">{children}</td>
    </tr>
  );
}

/**
 * The Plan Tenure and Dividend Statement from "KUUN Business Rates and Document Samples" in the library: the client's
 * plan, contributions, dividend rate, dividends per period and the amount due at maturity. Before maturity it shows the
 * position so far.
 */
export default async function PlanStatement({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(administrationModule);
  const { id } = await params;
  const data = await getPlanLetter(id);
  if (!data || data.member.status !== "approved" || data.plan.status === "cancelled") notFound();
  const { plan, member, manager } = data;

  const issued = today();
  const matured = issued >= plan.maturity_date;
  const verified = standingContributions(data.contributions).filter((c) => c.verified_at);
  const unverified = standingContributions(data.contributions).filter((c) => !c.verified_at);
  const s = dividendStatement(plan, verified, matured ? undefined : issued);
  // Plans that pay interest every month have already had their dividends; only Target savings pays them at maturity.
  const paidOut = plan.dividends_at_maturity ? 0 : s.totalDividends;
  const payable = s.totalContributions + s.totalDividends - paidOut;
  const name = letterName(member);
  const rate = s.periods[0]?.rate ?? 0;

  return (
    <Letter
      title={`Plan tenure and dividend statement · ${name}`}
      date={issued}
      backHref={`/administration/members/${member.id}?tab=plans`}
      backLabel="Back to the member's plans"
      gaps={[
        !member.membership_no && "The member's membership number",
        !manager && "A Branch Manager for this branch, to authorise the statement",
      ].filter((g): g is string => Boolean(g))}
      notes={
        <>
          Counts verified contributions only
          {unverified.length > 0 && ` (${unverified.length} not verified yet, left out)`}. Dividends use the monthly rate on each full month a contribution is held; a month held 21 days or more counts as
          full, and a shorter part month earns nothing. Upload the issued copy on the member&apos;s file as a &quot;Statement of account&quot; or
          &quot;Maturity and liquidation letter&quot;.
        </>
      }
    >
      <div className="text-center">
        <p className="text-[12pt] font-bold">KUUN (SILVER KUUN GROUP)</p>
        <p className="text-[13pt] font-extrabold tracking-wide">PLAN TENURE &amp; DIVIDEND STATEMENT</p>
        <p className="text-[10pt]">{matured ? "Client End-of-Tenure Report" : `Position as at ${formatDate(issued)}`}</p>
      </div>

      <h2 className="mt-4 font-bold">A. Client Information</h2>
      <table className="mt-1 w-full border-collapse text-[9.5pt]">
        <tbody>
          <Row label="Client Name">{name}</Row>
          <Row label="Membership Number">{member.membership_no ?? "—"}</Row>
          <Row label="Plan Name">{data.planName}</Row>
          <Row label="Plan Start Date">{formatDate(plan.start_date)}</Row>
          <Row label="Plan Maturity Date">{formatDate(plan.maturity_date)}</Row>
          <Row label="Tenure">{tenureWords(plan.start_date, plan.maturity_date)}</Row>
        </tbody>
      </table>

      <h2 className="mt-4 font-bold">B. Contribution and Dividend Summary</h2>
      <table className="mt-1 w-full border-collapse text-[9.5pt]">
        <tbody>
          <Row label="Total Contributions">{naira(s.totalContributions)}</Row>
          <Row label="Applicable Dividend Rate">{percent(rate)} monthly</Row>
          <Row label={matured ? "Total Dividends Earned" : "Total Dividends Earned so far"}>{naira(s.totalDividends)}</Row>
          <Row label="Additional Credits/Adjustments">{naira(0)}</Row>
          <Row label={plan.dividends_at_maturity ? "Deductions, if applicable" : "Deductions: dividends paid out monthly"}>
            {naira(paidOut)}
          </Row>
          <Row label={matured ? "Total Amount Payable at Maturity" : "Total Amount Payable at Maturity, so far"} strong>
            {naira(payable)}
          </Row>
        </tbody>
      </table>

      <h2 className="mt-4 font-bold">C. Dividend Breakdown</h2>
      <table className="mt-1 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="bg-amber-100 print:bg-amber-100">
            <th className="border border-neutral-400 px-2 py-1 text-left">Period</th>
            <th className="border border-neutral-400 px-2 py-1 text-right">Contribution Balance</th>
            <th className="border border-neutral-400 px-2 py-1 text-right">Rate Applied</th>
            <th className="border border-neutral-400 px-2 py-1 text-right">Dividend Earned</th>
          </tr>
        </thead>
        <tbody>
          {s.periods.map((p) => (
            <tr key={p.no} className="break-inside-avoid">
              <td className="border border-neutral-400 px-2 py-0.5">
                Period {p.no}{" "}
                <span className="text-[8pt] text-neutral-600">
                  ({formatDate(p.from)} to {formatDate(p.to)})
                </span>
              </td>
              <td className="border border-neutral-400 px-2 py-0.5 text-right tabular-nums">{naira(p.balance)}</td>
              <td className="border border-neutral-400 px-2 py-0.5 text-right tabular-nums">{percent(p.rate)}</td>
              <td className="border border-neutral-400 px-2 py-0.5 text-right tabular-nums">{naira(p.dividend)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="border border-neutral-400 px-2 py-1" colSpan={3}>
              Total
            </td>
            <td className="border border-neutral-400 px-2 py-1 text-right tabular-nums">{naira(s.totalDividends)}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-4 font-bold">D. Maturity Summary</h2>
      <p className="mt-1 text-justify">
        {matured
          ? "Your plan has reached the end of its tenure. This statement summarises your contributions, dividends earned during the plan period, applicable adjustments, and the total amount payable at maturity."
          : `Your plan matures on ${formatDate(plan.maturity_date)}. This statement summarises your contributions and the dividends earned so far, and what is payable at maturity on the savings held today.`}
      </p>

      <div className="mt-5 grid grid-cols-3 gap-4 text-[9.5pt]">
        <p>
          Prepared by: <span className="font-semibold">{staff.fullName}</span>
        </p>
        <p>
          Authorised by: <span className="font-semibold">{manager ?? "...................."}</span>
        </p>
        <p>
          Date Issued: <span className="font-semibold">{formatDate(issued)}</span>
        </p>
      </div>

      <SignOff manager={manager} closing="Thank you for your partnership." />
    </Letter>
  );
}
