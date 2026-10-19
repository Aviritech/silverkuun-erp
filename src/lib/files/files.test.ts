import { describe, expect, it } from "vitest";
import type { ReportResult } from "@/lib/reports/types";
import { pdfSafe, reportToPdf } from "./pdf";
import { readXlsxRows, reportToXlsx } from "./xlsx";
import { createZip, readZip } from "./zip";

const result: ReportResult = {
  columns: [
    { key: "name", label: "Account" },
    { key: "on", label: "Date", kind: "date" },
    { key: "amount", label: "Amount", kind: "money" },
  ],
  rows: [
    { name: "Cash & bank <main>", on: "2026-10-01", amount: 1500.5 },
    { name: "=SUM(A1)", on: null, amount: -20 },
    { name: "Total", amount: 1480.5, _kind: "total" },
  ],
  notes: ["Debits equal credits."],
};

describe("zip", () => {
  it("round-trips files", () => {
    const zip = createZip([
      { name: "a.txt", data: "hello" },
      { name: "dir/b.txt", data: Buffer.from("x".repeat(10000)) },
    ]);
    const files = readZip(zip);
    expect(files.get("a.txt")?.toString()).toBe("hello");
    expect(files.get("dir/b.txt")?.length).toBe(10000);
  });

  it("rejects something that isn't a zip", () => {
    expect(() => readZip(Buffer.from("not a zip at all, just some text padding padding"))).toThrow();
  });
});

describe("xlsx", () => {
  it("writes a workbook that reads back with numbers kept as numbers", () => {
    const file = reportToXlsx(result, { title: "Trial balance", scope: "2026-01-01 to 2026-10-19" });
    const rows = readXlsxRows(file);
    expect(rows[0]).toEqual(["Trial balance"]);
    expect(rows[2]).toEqual(["Account", "Date", "Amount"]);
    expect(rows[3][0]).toBe("Cash & bank <main>");
    expect(Number(rows[3][1])).toBe(46296); // 1 Oct 2026 as a spreadsheet serial
    expect(rows[3][2]).toBe("1500.5");
    // Text stays text, so a formula-looking value can't run.
    expect(rows[4][0]).toBe("=SUM(A1)");
    const sheet = readZip(file).get("xl/worksheets/sheet1.xml")!.toString();
    expect(sheet).not.toContain("<f>");
  });
});

describe("pdf", () => {
  it("produces a PDF with the report text", () => {
    const pdf = reportToPdf(result, { title: "Trial balance", scope: "Lagos", generated: "Generated today" });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("(Trial balance)");
    expect(text).toContain("(1,500.50)");
    expect(text).toContain("Cash & bank <main>");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("paginates long reports", () => {
    const long = { ...result, rows: Array.from({ length: 200 }, (_, i) => ({ name: `Line ${i}`, amount: i })) };
    const text = reportToPdf(long, { title: "GL", scope: "", generated: "" }).toString("latin1");
    expect(text).toMatch(/\/Count [4-9]/);
  });

  it("replaces characters the standard fonts can't draw", () => {
    expect(pdfSafe("₦5 — done…")).toBe("NGN 5 - done...");
  });
});
