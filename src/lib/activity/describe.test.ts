import { describe, expect, it } from "vitest";
import { describePath } from "./describe";

const ID = "3f6c1a52-9a4e-4b39-8d7e-0f3a0b7a1c22";

describe("describePath", () => {
  it("names pages after the department navigation", () => {
    expect(describePath("/administration/members")).toEqual({ module: "administration", label: "Members" });
    expect(describePath("/administration")).toEqual({ module: "administration", label: "Overview" });
    expect(describePath("/me/leave")).toEqual({ module: "me", label: "My leave" });
    expect(describePath("/")).toEqual({ module: null, label: "Home" });
  });

  it("says when a record is opened, created or edited", () => {
    expect(describePath(`/administration/members/${ID}`).label).toBe("Members · open record");
    expect(describePath(`/administration/members/${ID}/edit`).label).toBe("Members · edit record");
    expect(describePath("/credit/loans/new").label).toBe("Loans · new");
    expect(describePath(`/hr/payroll/${ID}/payslips/${ID}`).label).toBe("Payroll · open record · payslips");
  });

  it("names reports after the report", () => {
    expect(describePath("/internal-audit/reports/audit-trail", (k) => (k === "audit-trail" ? "Audit trail" : undefined))).toEqual({
      module: "internal_audit",
      label: "Report: Audit trail",
    });
    expect(describePath("/credit/reports/par").label).toBe("Report: Par");
  });

  it("ignores query strings and trailing slashes", () => {
    expect(describePath("/administration/members/?q=ade").label).toBe("Members");
  });
});
