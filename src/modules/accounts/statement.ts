import { parseCsv } from "@/lib/reports/csv";

/** Which statement column holds each field. Saved per bank account. */
export type ImportMapping = {
  date: string;
  description: string;
  reference?: string;
  debit: string;
  credit: string;
  balance?: string;
};

export type StatementLine = { date: string; description: string; reference: string | null; amount: number; balance: number | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Accepts 2026-10-19, 19/10/2026, 19-10-2026, 19.10.2026, 19-Oct-2026 and 19 Oct 2026. Nigerian banks put the day first. */
export function parseStatementDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = v.match(/^(\d{1,2})[\s/-]([A-Za-z]{3})[A-Za-z]*[\s/-](\d{2,4})$/))) {
    [d, m, y] = [Number(match[1]), MONTHS.indexOf(match[2].toLowerCase()) + 1, Number(match[3])];
  } else {
    return null;
  }
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "1,250.50", "₦1,250.50", "(1,250.50)" and "-1250.5" all parse; blanks are null. */
export function parseStatementAmount(value: string | undefined): number | null {
  if (value === undefined) return null;
  let v = value.trim().replace(/[₦,\s]|NGN/gi, "");
  if (!v || v === "-") return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(v)) return Number.NaN;
  const n = Math.round(Number(v) * 100) / 100;
  return negative ? -n : n;
}

/**
 * Reads a bank statement CSV using the saved column mapping. Money in (credit) becomes a positive amount and money
 * out (debit) a negative one. Rows that can't be read are reported, not silently dropped.
 */
export function parseStatement(text: string, mapping: ImportMapping): { lines: StatementLine[]; errors: string[] } {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) return { lines: [], errors: ["The file has no statement lines."] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string | undefined) => (name ? header.indexOf(name.trim().toLowerCase()) : -1);
  const idx = {
    date: col(mapping.date),
    description: col(mapping.description),
    reference: col(mapping.reference),
    debit: col(mapping.debit),
    credit: col(mapping.credit),
    balance: col(mapping.balance),
  };
  const missing = (["date", "description", "debit", "credit"] as const).filter((k) => idx[k] < 0).map((k) => `"${mapping[k]}"`);
  if (missing.length) return { lines: [], errors: [`These columns aren't in the file: ${missing.join(", ")}. Check the column names.`] };

  const lines: StatementLine[] = [];
  rows.slice(1).forEach((row, i) => {
    const rowNo = i + 2;
    const date = parseStatementDate(row[idx.date] ?? "");
    const debit = parseStatementAmount(row[idx.debit]);
    const credit = parseStatementAmount(row[idx.credit]);
    const balance = idx.balance >= 0 ? parseStatementAmount(row[idx.balance]) : null;
    if (!date) return void errors.push(`Row ${rowNo}: can't read the date "${row[idx.date] ?? ""}".`);
    if ([debit, credit, balance].some((n) => Number.isNaN(n))) return void errors.push(`Row ${rowNo}: can't read an amount.`);
    const amount = Math.round(((credit ?? 0) - Math.abs(debit ?? 0)) * 100) / 100;
    if (amount === 0) return; // opening/closing balance rows and blank lines
    lines.push({
      date,
      description: (row[idx.description] ?? "").trim(),
      reference: idx.reference >= 0 ? (row[idx.reference] ?? "").trim() || null : null,
      amount,
      balance,
    });
  });
  return { lines, errors };
}
