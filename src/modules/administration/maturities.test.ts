import { describe, expect, it } from "vitest";
import { maturityRange } from "./reports";

const run = (window: string, from = "2026-01-01", to = "2026-01-31") => ({ from, to, options: { window } });

describe("maturity windows", () => {
  it("covers Monday to Sunday of this week and next week", () => {
    // 30 October 2026 is a Friday.
    expect(maturityRange(run("this_week"), "2026-10-30")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(maturityRange(run("next_week"), "2026-10-30")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    // On a Sunday the week is the one ending today; on a Monday it starts today.
    expect(maturityRange(run("this_week"), "2026-11-01")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(maturityRange(run("this_week"), "2026-11-02")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
  });

  it("uses the chosen dates for a custom range, and no range for the day windows", () => {
    expect(maturityRange(run("custom", "2026-12-01", "2026-12-15"))).toEqual({ from: "2026-12-01", to: "2026-12-15" });
    expect(maturityRange(run("60"))).toBeNull();
    expect(maturityRange(run("all"))).toBeNull();
  });
});
