import type { ReportResult } from "./types";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Quote anything with separators, and neutralise leading characters spreadsheets treat as formulas.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A CSV file that opens directly in Excel (UTF-8 with BOM, CRLF line endings). */
export function toCsv(result: ReportResult): string {
  const lines = [result.columns.map((c) => cell(c.label)).join(",")];
  for (const row of result.rows) lines.push(result.columns.map((c) => cell(row[c.key])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Splits CSV text into rows of cells, handling quoted fields, escaped quotes and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}
