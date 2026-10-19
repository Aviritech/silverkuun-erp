import type { ReportDefinition, ReportFilters } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startOfYear(date = today()): string {
  return `${date.slice(0, 4)}-01-01`;
}

/** Reads report filters from the query string, falling back to the year to date. Anything malformed is ignored. */
export function parseFilters(report: ReportDefinition, params: Record<string, string | string[] | undefined>): ReportFilters {
  const get = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const to = ISO_DATE.test(get("to")) ? get("to") : today();
  const from = ISO_DATE.test(get("from")) && get("from") <= to ? get("from") : startOfYear(to);
  const options: Record<string, string> = {};
  for (const option of report.options ?? []) {
    const value = get(option.name);
    options[option.name] = option.choices.some((c) => c.value === value) ? value : option.choices[0].value;
  }
  // A single ledger account, when a report is opened from a trial balance line.
  if (/^\d{4}$/.test(get("account"))) options.account = get("account");
  return {
    from,
    to,
    branch: UUID.test(get("branch")) ? get("branch") : null,
    region: UUID.test(get("region")) ? get("region") : null,
    options,
  };
}

export function filtersToQuery(filters: ReportFilters): string {
  const q = new URLSearchParams({ from: filters.from, to: filters.to, ...filters.options });
  if (filters.branch) q.set("branch", filters.branch);
  if (filters.region) q.set("region", filters.region);
  return q.toString();
}
