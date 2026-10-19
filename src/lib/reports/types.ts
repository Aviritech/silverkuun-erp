import type { SupabaseClient } from "@supabase/supabase-js";

export type ColumnKind = "text" | "money" | "number" | "date" | "datetime";

export type Column = { key: string; label: string; kind?: ColumnKind };

/** A report row. `_kind` styles headings and totals; `_href` links the first cell. */
export type Row = Record<string, string | number | null | undefined> & {
  _kind?: "heading" | "subtotal" | "total";
  _href?: string;
};

export type ReportResult = { columns: Column[]; rows: Row[]; notes?: string[] };

export type ReportFilters = {
  from: string;
  to: string;
  branch: string | null;
  region: string | null;
  /** Department code, for reports with dimension filters. */
  department: string | null;
  /** Savings product (plan type) code, for reports with dimension filters. */
  product: string | null;
  /** Report-specific choices, such as status or grouping. */
  options: Record<string, string>;
};

export type ReportOption = { name: string; label: string; choices: { value: string; label: string }[] };

export type ReportDefinition = {
  key: string;
  title: string;
  description: string;
  /** The department module the report lives under, for links back. */
  basePath: "/accounts" | "/internal-audit" | "/administration";
  /** Needed to run or export the report. */
  permission: string;
  /** "period" shows from/to; "asAt" shows a single date (uses `to`). */
  dates: "period" | "asAt" | "none";
  branchFilter: boolean;
  /** Which of the department and savings product filters the report offers. */
  dimensionFilters?: readonly ("department" | "product")[];
  options?: ReportOption[];
  run: (supabase: SupabaseClient, filters: ReportFilters) => Promise<ReportResult>;
};
