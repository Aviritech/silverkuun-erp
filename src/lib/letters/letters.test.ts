import { describe, expect, it } from "vitest";
import { dividendStatement } from "./dividends";
import { letterDate, monthlyRate, naira, nairaInWords, nextPayDay, numberToWords, ordinal, tenureWords } from "./words";

describe("letter wording", () => {
  it("writes amounts in words like the library samples", () => {
    expect(nairaInWords(35_000_000)).toBe("THIRTY-FIVE MILLION NAIRA ONLY");
    expect(nairaInWords(17_500_000)).toBe("SEVENTEEN MILLION, FIVE HUNDRED THOUSAND NAIRA ONLY");
    expect(nairaInWords(2_275_000)).toBe("TWO MILLION, TWO HUNDRED AND SEVENTY-FIVE THOUSAND NAIRA ONLY");
    expect(nairaInWords(1_050_000)).toBe("ONE MILLION, FIFTY THOUSAND NAIRA ONLY");
    expect(nairaInWords(33_600_000)).toBe("THIRTY-THREE MILLION, SIX HUNDRED THOUSAND NAIRA ONLY");
    expect(nairaInWords(1500.5)).toBe("ONE THOUSAND, FIVE HUNDRED NAIRA, FIFTY KOBO ONLY");
    expect(numberToWords(1_000_050)).toBe("one million and fifty");
    expect(numberToWords(0)).toBe("zero");
  });

  it("prints figures and dates the way the letters do", () => {
    expect(naira(35_000_000)).toBe("N35,000,000");
    expect(naira("2275000.50")).toBe("N2,275,000.50");
    expect(letterDate("2026-03-24")).toBe("24TH MARCH, 2026");
    expect(letterDate("2026-10-01")).toBe("1ST OCTOBER, 2026");
    expect(letterDate("2026-06-22")).toBe("22ND JUNE, 2026");
    expect(ordinal(13)).toBe("13TH");
    expect(ordinal(23)).toBe("23RD");
  });

  it("names tenures in years, months or days", () => {
    expect(tenureWords("2026-03-24", "2027-03-24")).toBe("1 YEAR");
    expect(tenureWords("2026-10-07", "2027-01-07")).toBe("3 MONTHS");
    expect(tenureWords("2026-01-31", "2026-02-28")).toBe("1 MONTH");
    expect(tenureWords("2026-06-26", "2026-07-25")).toBe("29 DAYS");
    expect(tenureWords("2026-01-01", "2028-01-01")).toBe("2 YEARS");
  });

  it("finds the first interest pay day after the letter", () => {
    expect(nextPayDay("2026-03-24", 24)).toBe("2026-04-24");
    expect(nextPayDay("2026-10-07", 28)).toBe("2026-10-28");
    expect(nextPayDay("2026-01-31", 31)).toBe("2026-02-28");
    expect(nextPayDay("2026-12-30", 15)).toBe("2027-01-15");
  });

  it("turns the stored annual rate into the monthly rate the letters quote", () => {
    expect(monthlyRate(48)).toBe(4);
    expect(monthlyRate("78.00")).toBe(6.5);
    expect(monthlyRate(42)).toBe(3.5);
  });
});

describe("dividend statement", () => {
  it("earns the monthly rate on each full month a contribution is held", () => {
    const s = dividendStatement({ start_date: "2026-01-10", maturity_date: "2026-04-10", interest_rate: 60 }, [
      { amount: 1_000_000, paid_on: "2026-01-10" },
      { amount: 500_000, paid_on: "2026-02-10" },
    ]);
    expect(s.periods.map((p) => p.balance)).toEqual([1_000_000, 1_500_000, 1_500_000]);
    expect(s.periods.map((p) => p.dividend)).toEqual([50_000, 75_000, 75_000]);
    expect(s.periods[0]).toMatchObject({ from: "2026-01-10", to: "2026-02-10", rate: 5 });
    expect(s.totalContributions).toBe(1_500_000);
    expect(s.totalDividends).toBe(200_000);
  });

  it("stops at the date asked for, and gives nothing for a part month", () => {
    const s = dividendStatement(
      { start_date: "2026-01-10", maturity_date: "2026-07-10", interest_rate: 48 },
      [
        { amount: 200_000, paid_on: "2026-01-10" },
        { amount: 100_000, paid_on: "2026-03-01" },
      ],
      "2026-03-20",
    );
    expect(s.periods).toHaveLength(6);
    expect(s.periods.map((p) => p.balance)).toEqual([200_000, 200_000, 0, 0, 0, 0]);
    expect(s.totalDividends).toBe(16_000);
    expect(s.totalContributions).toBe(300_000);
  });

  it("counts a part month held for 21 days or more as a full month", () => {
    const plan = { start_date: "2026-01-10", maturity_date: "2026-07-10", interest_rate: 48 };
    // Held two months and 21 days: three months earned.
    const s = dividendStatement(plan, [{ amount: 200_000, paid_on: "2026-01-10" }], "2026-03-31");
    expect(s.totalDividends).toBe(24_000);
    // Two months and 20 days: still two.
    expect(dividendStatement(plan, [{ amount: 200_000, paid_on: "2026-01-10" }], "2026-03-30").totalDividends).toBe(16_000);
  });
});
