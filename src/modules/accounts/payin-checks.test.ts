import { describe, expect, it } from "vitest";
import { checkPayIns, type PayIn, type StatementLine } from "./payin-checks";

const payIn = (o: Partial<PayIn> = {}): PayIn => ({
  id: "p1",
  member_id: "m1",
  branch_id: "b1",
  amount: 250000,
  paid_on: "2026-10-22",
  reference: null,
  payment_method: "bank_transfer",
  ...o,
});
const line = (o: Partial<StatementLine> = {}): StatementLine => ({
  id: "l1",
  bank_account_id: "bank1",
  branch_id: "b1",
  line_date: "2026-10-22",
  amount: 250000,
  reference: null,
  description: "",
  ...o,
});

describe("checkPayIns", () => {
  it("finds a bank line with the same amount in the same branch within the window", () => {
    const r = checkPayIns([payIn()], [line({ line_date: "2026-10-25" })], []);
    expect(r.get("p1")!.line?.id).toBe("l1");
  });

  it("ignores lines outside the window, in other branches, or for other amounts", () => {
    const lines = [line({ id: "late", line_date: "2026-10-30" }), line({ id: "other", branch_id: "b2" }), line({ id: "amt", amount: 250001 })];
    expect(checkPayIns([payIn()], lines, []).get("p1")!.line).toBeNull();
  });

  it("does not look for bank lines for cash pay-ins", () => {
    expect(checkPayIns([payIn({ payment_method: "cash" })], [line()], []).get("p1")!.line).toBeNull();
  });

  it("gives each line to one pay-in, preferring the one whose reference matches", () => {
    const a = payIn({ id: "a", member_id: "m1" });
    const b = payIn({ id: "b", member_id: "m2", reference: "TR-19208" });
    const r = checkPayIns([a, b], [line({ reference: "TR19208" })], []);
    expect(r.get("b")!.line?.id).toBe("l1");
    expect(r.get("a")!.line).toBeNull();
  });

  it("flags a pay-in that repeats a recorded receipt or another pay-in", () => {
    const r = checkPayIns(
      [payIn({ id: "a" }), payIn({ id: "b" }), payIn({ id: "c", member_id: "m9" })],
      [],
      [{ id: "t1", txn_no: "RCT-000001", member_id: "m9", amount: 250000, txn_date: "2026-10-22" }],
    );
    expect(r.get("a")!.duplicateOf).toEqual({ kind: "payin", id: "b" });
    expect(r.get("c")!.duplicateOf).toEqual({ kind: "receipt", id: "t1", txn_no: "RCT-000001" });
  });
});
