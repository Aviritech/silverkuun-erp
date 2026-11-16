import { AddressBlock, Blank, LetterDate, SignOff } from "@/components/letter";
import { SOCIETY } from "@/lib/letters/letterhead";
import { naira, nairaInWords, ordinal, percent } from "@/lib/letters/words";

export type DepositLetterTerms = {
  /** "new" and "rollover" follow the Roll-over sample; "top_up" the Top-up sample. */
  kind: "new" | "rollover" | "top_up";
  name: string;
  membershipNo: string | null;
  address: string;
  /** The amount in the heading: the deposit, or the top-up. */
  headingAmount: number;
  /** The deposit the letter confirms: the plan amount, or the plan's total after the top-up. */
  deposit: number;
  /** Null for a one-off fixed deposit; "monthly", "weekly"... for a plan paid in instalments. */
  frequency: string | null;
  tenure: string;
  /** Monthly rate, in percent. */
  rate: number;
  dividendsAtMaturity: boolean;
  maturityDate: string;
  payDay: number | null;
  firstPay: string | null;
  /** "A/C 1811428973 /ACCESS BANK/NAME", or null when the member's bank isn't on file. */
  account: string | null;
  manager: string | null;
};

function Day({ day }: { day: number | null }) {
  if (!day) return <Blank width="w-10" />;
  return (
    <>
      {day}
      <sup>{ordinal(day).slice(String(day).length)}</sup>
    </>
  );
}

const plainWords = (n: number) => nairaInWords(n).replace(/ NAIRA ONLY$/, "");

/**
 * The body of the membership agreement letters in the project library ("Roll-over membership agreement letter" and
 * "Top-up membership agreement letter"): address, heading, clauses 1 to 8, the liquidation note and the sign-off.
 */
export function DepositLetter(t: DepositLetterTerms) {
  const instalments = t.frequency ? ` ${t.frequency}` : "";
  const monthlyInterest = Math.round(t.deposit * t.rate) / 100;
  const account = <strong>({t.account ?? <Blank width="w-56" />})</strong>;
  const label = t.kind === "top_up" ? "TOP-UP " : t.kind === "rollover" ? "ROLL-OVER " : "";

  return (
    <>
      <AddressBlock address={t.address} />

      <div className="mt-3 font-semibold uppercase">
        <p>DEAR {t.name}</p>
        <p>
          CONFIRMATION {label}OF REDEEMABLE CONTRIBUTION OF {naira(t.headingAmount)}
          {t.kind !== "top_up" && instalments.toUpperCase()} FOR THE PERIOD OF {t.tenure} IN FAVOUR OF {t.name} WITH
          MEMBERSHIP NUMBER <Blank width="w-28">{t.membershipNo}</Blank>
        </p>
      </div>

      <p className="mt-3 text-justify">
        We received your contribution of {t.frequency ? "" : "a fixed deposit of "}
        <strong>
          {nairaInWords(t.deposit)} ({naira(t.deposit)})
        </strong>
        {instalments} for the period of {t.tenure} and hereby agrees as follows
      </p>

      <ol className="mt-3 list-decimal space-y-1.5 pl-[12mm] pr-2 text-justify">
        <li>
          By accepting the sum OF {plainWords(t.deposit)} Naira Only ({naira(t.deposit)}){instalments} for {t.tenure}, we do
          undertake the obligation to return the deposit to the depositor whenever he/she needs the money after giving{" "}
          {SOCIETY.liquidationNoticeWeeks} WEEKS notice to <strong>{SOCIETY.signOff}</strong>
        </li>
        {t.dividendsAtMaturity ? (
          <li>
            The dividend rate of the deposited amount is {percent(t.rate)} monthly. Dividends build up over the tenure and will
            be paid together with the deposit at maturity on <LetterDate date={t.maturityDate} /> into the depositor&apos;s
            account {account} as instructed by the depositor.
          </li>
        ) : (
          <>
            <li>
              The interest rate of the deposited amount is {percent(t.rate)} monthly
              {t.frequency ? (
                " on the savings held"
              ) : (
                <>
                  {" "}
                  ({naira(monthlyInterest)}) {plainWords(monthlyInterest)} Naira Only
                </>
              )}{" "}
              will be paid into the depositor&apos;s account on the <Day day={t.payDay} /> of every month starting from{" "}
              {t.firstPay ? <LetterDate date={t.firstPay} /> : <Blank width="w-32" />} {account} as instructed by the
              depositor.
            </li>
            <li>
              Depositor interest period shall be on the <Day day={t.payDay} /> of every month for {t.tenure} without default.
            </li>
          </>
        )}
        <li>
          Liquidation of fixed deposit before Maturity date attracts {SOCIETY.earlyLiquidationCharge} of the total deposited
          amount.
        </li>
        <li>
          <strong>{SOCIETY.signOff}</strong> agrees to keep confidentiality of the information by the law of Nigeria
          Cooperative Board.
        </li>
        <li>We agree that the said fixed deposit will be renewed for such period of time as you may instruct.</li>
        <li>We&apos;re a secured Company and our Bank Is {SOCIETY.banks}.</li>
        <li>
          We&apos;re a member of the non-microfinance institution of Nigeria <strong>(ANMFIN)</strong>
        </li>
      </ol>

      <div className="mt-3 pl-[6mm] font-semibold uppercase">
        <p>Please note</p>
        <p>
          For every liquidation kindly inform the management {SOCIETY.liquidationNoticeWeeks} weeks prior to the time of
          liquidating.
        </p>
      </div>

      <SignOff manager={t.manager} />
    </>
  );
}

/** "A/C 1811428973 /ACCESS BANK/OLUWATOYIN OLASENI OLUSEYE", as the samples write the member's account. */
export function accountLine(m: { bank_account_no: string | null; bank_name: string | null }, name: string): string | null {
  return m.bank_account_no ? `A/C ${m.bank_account_no} /${(m.bank_name ?? "").toUpperCase()}/${name}` : null;
}
