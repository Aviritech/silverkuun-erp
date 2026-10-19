import Link from "next/link";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { Column, Row } from "@/lib/reports/types";
import { EmptyState } from "./ui";

export function formatCell(value: Row[string], kind: Column["kind"]): string {
  if (value === null || value === undefined || value === "") return kind === "money" ? "" : "—";
  switch (kind) {
    case "money":
      return formatMoney(value);
    case "number":
      return Number(value).toLocaleString("en-NG");
    case "date":
      return formatDate(String(value));
    case "datetime":
      return formatDateTime(String(value));
    default:
      return String(value);
  }
}

const rowStyles = {
  heading: "bg-silver-50 font-semibold",
  subtotal: "font-medium border-t border-zinc-300",
  total: "font-semibold border-t-2 border-zinc-400 bg-silver-50",
};

/** A plain table for reports and lists. Money and numbers are right-aligned. */
export function DataTable({ columns, rows, empty = "Nothing to show." }: { columns: Column[]; rows: Row[]; empty?: string }) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  const numeric = (c: Column) => c.kind === "money" || c.kind === "number";
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-zinc-200 bg-silver-50/60 text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={`px-3 py-2 font-medium ${numeric(c) ? "text-right" : ""}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={`border-b border-zinc-100 last:border-0 hover:bg-silver-50/60 ${row._kind ? rowStyles[row._kind] : ""}`}>
            {columns.map((c, j) => {
              const text = formatCell(row[c.key], c.kind);
              return (
                <td key={c.key} className={`px-3 py-2 ${numeric(c) ? "whitespace-nowrap text-right tabular-nums" : ""}`}>
                  {j === 0 && row._href ? (
                    <Link href={row._href} className="font-medium text-ink underline-offset-4 hover:underline">
                      {text}
                    </Link>
                  ) : (
                    text
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
