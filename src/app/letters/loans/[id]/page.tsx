import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddressBlock, Blank, Letter, LetterDate, SignOff } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import { SOCIETY } from "@/lib/letters/letterhead";
import { naira, nairaInWords, percent, tenureWords } from "@/lib/letters/words";
import { today } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { REPAYMENT_FREQUENCIES } from "@/modules/credit/constants";
import { creditModule } from "@/modules/credit/module";
import type { Installment, Loan } from "@/modules/credit/queries";
import { loanSchedule } from "@/modules/credit/schedule";
import { branchManagerName, getLetterMember, letterName } from "@/modules/administration/letters";

export const metadata: Metadata = { title: "Loan offer letter · Silverkuun ERP" };

const OFFERED = ["approved", "active", "closed"];

/** "12 MONTHS", "1 MONTH" for a loan's tenor. */
function tenorWords(months: number) {
  return months % 12 === 0 && months >= 12
    ? `${months / 12} ${months === 12 ? "YEAR" : "YEARS"}`
    : `${months} ${months === 1 ? "MONTH" : "MONTHS"}`;
}

/** The loan offer letter, from the two-page "Membership loan application" sample in the library. */
export default async function LoanOfferLetter({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(creditModule);
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("loans").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  const loan = data as Loan | null;
  if (!loan || !OFFERED.includes(loan.status)) notFound();

  const [member, manager, installments] = await Promise.all([
    getLetterMember(loan.member_id),
    branchManagerName(loan.branch_id),
    supabase.from("loan_schedule_status").select("*").eq("loan_id", id).order("installment_no"),
  ]);
  if (installments.error) throw dbFailure(installments.error);
  if (!member) notFound();

  const principal = Number(loan.approved_amount ?? loan.amount_requested);
  const requested = Number(loan.amount_requested);
  const start = loan.disbursed_on ?? today();
  // Once disbursed the loan has its schedule; before that, the same calculation the application form previews.
  const saved = (installments.data ?? []) as Installment[];
  const schedule = saved.length
    ? saved.map((i) => ({ installment_no: i.installment_no, due_date: i.due_date, principal_due: Number(i.principal_due), interest_due: Number(i.interest_due) }))
    : loanSchedule({
        principal,
        interestRate: Number(loan.interest_rate),
        rateBasis: loan.rate_basis,
        interestMethod: loan.interest_method,
        frequency: loan.repayment_frequency,
        tenorMonths: loan.tenor_months,
        start,
        firstDue: loan.first_repayment_date,
      });
  const interest = Math.round(schedule.reduce((s, l) => s + l.interest_due, 0) * 100) / 100;
  const total = principal + interest;
  const maturity = loan.maturity_date ?? schedule.at(-1)?.due_date ?? null;
  const tenor = maturity ? tenureWords(start, maturity) : tenorWords(loan.tenor_months);
  const name = letterName(member);
  const words = (n: number) => nairaInWords(n).replace(/ NAIRA ONLY$/, "");
  const oneRepayment = schedule.length <= 1;

  const gaps = [
    !member.membership_no && "The member's membership number",
    !member.bank_account_no && "The member's bank account (on the member's details)",
    !manager && "A Branch Manager for this branch, to sign the letter",
  ].filter(Boolean) as string[];

  return (
    <Letter
      title={`Loan offer letter · ${loan.loan_no} · ${name}`}
      date={start}
      backHref={`/credit/loans/${loan.id}`}
      backLabel={`Back to loan ${loan.loan_no}`}
      gaps={gaps}
      notes={
        <>
          {loan.disbursed_on
            ? "Dated the day the loan was disbursed, with its repayment schedule."
            : "Dated today, as the loan is not disbursed yet; the repayment figures are the expected schedule from today."}{" "}
          Have the member sign the acceptance, then upload it on the loan as the &quot;Signed offer letter&quot;.
        </>
      }
    >
      <AddressBlock address={loan.address || member.address} />

      <div className="mt-5 font-semibold uppercase">
        <p>DEAR {name}</p>
        <p>
          LOAN APPLICATION OF {naira(principal).slice(1)} ONLY FOR {tenor} IN FAVOUR OF {name} WITH MEMBERSHIP NUMBER{" "}
          <Blank width="w-28">{member.membership_no}</Blank>
        </p>
      </div>

      <div className="mt-3 space-y-3 text-justify">
        <p>
          We received your application requesting for a loan of{" "}
          <strong>
            {nairaInWords(requested)} ({naira(requested)})
          </strong>
          .
        </p>
        <p>
          After meeting all membership requirements and subsequent discussion with you, we are pleased to inform you that
          the management of {SOCIETY.lender}, has approved the sum of{" "}
          <strong>
            {words(principal)} NAIRA ({naira(principal).slice(1)}) only
          </strong>{" "}
          for you as a loan under the following condition;
        </p>
        <div className="space-y-1.5">
          <p>LENDER: {SOCIETY.lender}</p>
          <p>Borrower: {name}</p>
          <p>
            Interest rate: {percent(loan.interest_rate)} {loan.rate_basis === "per_month" ? "monthly" : "per annum"}
            {loan.interest_method === "reducing_balance" ? " (on the reducing balance)" : ""}
          </p>
          <p>Tenor: {tenor.toLowerCase()}</p>
          {!oneRepayment && (
            <p>
              Repayment: {schedule.length} {REPAYMENT_FREQUENCIES[loan.repayment_frequency].toLowerCase()} instalments
            </p>
          )}
          <p>
            Disbursement date: <LetterDate date={start} />
          </p>
          <p>Maturity date: {maturity ? <LetterDate date={maturity} /> : <Blank />}</p>
        </div>
        {oneRepayment ? (
          <p>
            The interest of <strong>{words(interest).toLowerCase()}</strong> only ({naira(interest).slice(1)}) and principal
            of <strong>{words(principal).toLowerCase()} Naira</strong> ({naira(principal).slice(1)}) only must be paid by the
            maturity date. If you fail to pay the principal and the interest as at when due, it shall be the discretion of
            the management to deduct such amount due from your redeemable contribution with the company.
          </p>
        ) : (
          <p>
            The principal and interest must be paid in {schedule.length}{" "}
            {REPAYMENT_FREQUENCIES[loan.repayment_frequency].toLowerCase()} instalments as set out in the repayment schedule
            below. If you fail to pay any instalment as at when due, it shall be the discretion of the management to deduct
            such amount due from your redeemable contribution with the company.
          </p>
        )}
        <p>
          You shall be liable to pay all reasonable legal fees should the default lead to litigation or otherwise and any
          other cost reasonably incurred to ensure you settle repayment as the case maybe. You are fully bound until this
          loan is fully paid.
        </p>
        <p>
          The principal amount of <strong>{words(principal).toLowerCase()} Naira</strong> ({naira(principal).slice(1)}) and
          the interest of <strong>{words(interest).toLowerCase()} Naira only</strong>. Your total repayment is{" "}
          <strong>
            {words(total)} Naira ({naira(total).slice(1)})
          </strong>
        </p>
        <p className="uppercase">
          Kindly note that we will not contact you after the maturity date of your loan. However, we shall deduct from your
          redeemable contribution.
        </p>

        {!oneRepayment && (
          <table className="w-full border-collapse text-[9pt]">
            <thead>
              <tr className="bg-amber-100">
                <th className="border border-neutral-400 px-2 py-0.5 text-left">No.</th>
                <th className="border border-neutral-400 px-2 py-0.5 text-left">Due date</th>
                <th className="border border-neutral-400 px-2 py-0.5 text-right">Principal</th>
                <th className="border border-neutral-400 px-2 py-0.5 text-right">Interest</th>
                <th className="border border-neutral-400 px-2 py-0.5 text-right">Total due</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((l) => (
                <tr key={l.installment_no} className="break-inside-avoid">
                  <td className="border border-neutral-400 px-2 py-0.5">{l.installment_no}</td>
                  <td className="border border-neutral-400 px-2 py-0.5">{formatDate(l.due_date)}</td>
                  <td className="border border-neutral-400 px-2 py-0.5 text-right tabular-nums">{naira(l.principal_due)}</td>
                  <td className="border border-neutral-400 px-2 py-0.5 text-right tabular-nums">{naira(l.interest_due)}</td>
                  <td className="border border-neutral-400 px-2 py-0.5 text-right tabular-nums">
                    {naira(l.principal_due + l.interest_due)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p>
          The sum of{" "}
          <strong>
            {words(principal)} NAIRA ({naira(principal).slice(1)})
          </strong>{" "}
          only will be credited to your account with the following details
        </p>
        <div className="break-inside-avoid">
          <p>BANK: {member.bank_name?.toUpperCase() ?? <Blank />}</p>
          <p>ACCOUNT NAME: {member.bank_account_no ? name : <Blank />}</p>
          <p>ACCOUNT NUMBER: {member.bank_account_no ?? <Blank />}</p>
        </div>
        <p className="break-inside-avoid">
          {name}, by signing this offer letter at this moment, accept the terms and conditions of{" "}
          {SOCIETY.lender.toUpperCase()}
        </p>
        <div className="flex justify-between pt-4 break-inside-avoid">
          <p>Signature ......................................</p>
          <p className="font-semibold">
            DATE: <LetterDate date={start} />
          </p>
        </div>
      </div>

      <SignOff manager={manager} closing="Thank you for your continuous patronage." />
    </Letter>
  );
}
