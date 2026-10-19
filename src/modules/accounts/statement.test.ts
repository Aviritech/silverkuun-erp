import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/reports/csv";
import { parseStatement, parseStatementAmount, parseStatementDate, parseStatementRows } from "./statement";

const mapping = { date: "Date", description: "Narration", reference: "Ref", debit: "Debit", credit: "Credit", balance: "Balance" };

describe("parseStatement", () => {
  it("reads money in as positive and money out as negative, skipping zero rows", () => {
    const csv = [
      "Date,Narration,Ref,Debit,Credit,Balance",
      "01/10/2026,Opening balance,,,,\"5,000,000.00\"",
      '02/10/2026,"TRF FROM ADA, OBI",TRF-1,,"50,000.00","5,050,000.00"',
      "03-Oct-2026,SMS ALERT CHARGES,,1075,,5048925",
    ].join("\n");
    const { lines, errors } = parseStatement(csv, mapping);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      { date: "2026-10-02", description: "TRF FROM ADA, OBI", reference: "TRF-1", amount: 50000, balance: 5050000 },
      { date: "2026-10-03", description: "SMS ALERT CHARGES", reference: null, amount: -1075, balance: 5048925 },
    ]);
  });

  it("reports rows it can't read and missing columns", () => {
    expect(parseStatement("Date,Narration,Debit,Credit\n31/02/2026,x,1,\n", mapping).errors[0]).toMatch(/Row 2/);
    expect(parseStatement("When,What\n1,2\n", mapping).errors[0]).toMatch(/aren't in the file/);
  });
});

describe("statement values", () => {
  it("parses common date and amount formats", () => {
    expect(parseStatementDate("2026-10-19")).toBe("2026-10-19");
    expect(parseStatementDate("19.10.26")).toBe("2026-10-19");
    expect(parseStatementDate("19 October 2026")).toBe("2026-10-19");
    expect(parseStatementDate("10/19/2026")).toBeNull();
    expect(parseStatementAmount("(1,250.50)")).toBe(-1250.5);
    expect(parseStatementAmount("₦ 2,000")).toBe(2000);
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("abc")).toBeNaN();
  });
});

describe("toCsv", () => {
  it("quotes separators and stops formula injection", () => {
    const csv = toCsv({ columns: [{ key: "a", label: "A" }], rows: [{ a: 'x,"y"' }, { a: "=HYPERLINK()" }, { a: -5 }] });
    expect(csv).toBe('﻿A\r\n"x,""y"""\r\n\'=HYPERLINK()\r\n-5\r\n');
  });
});

describe("parseStatementRows (Excel statements)", () => {
  it("skips the bank's details above the column names and reads Excel date numbers", () => {
    const rows = [
      ["GTBank statement of account", "", "", "", "", ""],
      ["Account", "0123456789", "", "", "", ""],
      [],
      ["Date", "Narration", "Ref", "Debit", "Credit", "Balance"],
      ["46296", "TRF FROM ADA OBI", "T1", "", "50000", "50000"],
      ["", "", "", "", "", ""],
      ["02/10/2026", "COT CHARGE", "", "250", "", "49750"],
    ];
    const { lines, errors } = parseStatementRows(rows, mapping);
    expect(errors).toEqual([]);
    expect(lines.map((l) => [l.date, l.amount])).toEqual([
      ["2026-10-01", 50000],
      ["2026-10-02", -250],
    ]);
  });

  it("numbers rows as they appear in the sheet when reporting problems", () => {
    const rows = [["Statement"], ["Date", "Narration", "Debit", "Credit"], ["not a date", "x", "1", ""]];
    expect(parseStatementRows(rows, mapping).errors[0]).toMatch(/Row 3/);
  });

  it("rejects date numbers outside a sensible range", () => {
    expect(parseStatementDate("46296")).toBe("2026-10-01");
    expect(parseStatementDate("99999")).toBeNull();
  });
});
