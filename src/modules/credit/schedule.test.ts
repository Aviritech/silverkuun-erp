import { describe, expect, it } from "vitest";
import { loanSchedule } from "./schedule";

describe("loanSchedule", () => {
  it("matches the database for a flat monthly loan, including month ends", () => {
    const lines = loanSchedule({
      principal: 100000,
      interestRate: 2.5,
      rateBasis: "per_month",
      interestMethod: "flat",
      frequency: "monthly",
      tenorMonths: 3,
      start: "2026-01-31",
    });
    expect(lines.map((l) => [l.due_date, l.principal_due, l.interest_due])).toEqual([
      ["2026-02-28", 33333.33, 2500],
      ["2026-03-31", 33333.33, 2500],
      ["2026-04-30", 33333.34, 2500],
    ]);
  });

  it("gives equal reducing-balance instalments that repay the principal exactly", () => {
    const lines = loanSchedule({
      principal: 100000,
      interestRate: 36,
      rateBasis: "per_annum",
      interestMethod: "reducing_balance",
      frequency: "monthly",
      tenorMonths: 6,
      start: "2026-01-15",
    });
    expect(lines[0].interest_due).toBe(3000);
    expect(lines.reduce((s, l) => s + l.principal_due, 0)).toBeCloseTo(100000, 2);
    expect(new Set(lines.slice(0, 5).map((l) => (l.principal_due + l.interest_due).toFixed(2))).size).toBe(1);
  });

  it("uses a chosen first repayment date and counts weekly instalments from the tenor", () => {
    const lines = loanSchedule({
      principal: 50000,
      interestRate: 5,
      rateBasis: "per_month",
      interestMethod: "flat",
      frequency: "weekly",
      tenorMonths: 3,
      start: "2026-01-01",
      firstDue: "2026-01-09",
    });
    expect(lines).toHaveLength(13);
    expect(lines[1].due_date).toBe("2026-01-16");
    expect(lines.reduce((s, l) => s + l.interest_due, 0)).toBeCloseTo(7500, 2);
  });
});
