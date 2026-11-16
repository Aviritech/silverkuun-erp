import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";
import { AUDITED_TABLES } from "@/modules/internal-audit/constants";

/** Opens the Usage page. Held by System Administrators and Internal Auditors. */
export const USAGE_PERMISSION = "activity.read";

export const USAGE_KINDS = {
  sign_in: "Signed in",
  sign_in_failed: "Failed sign-in",
  sign_out: "Signed out",
  page_view: "Opened a page",
  change: "Changed a record",
  download: "Downloaded a report",
  password_changed: "Changed password",
} as const;
export type UsageKind = keyof typeof USAGE_KINDS;

export const MODULE_NAMES: Record<string, string> = {
  administration: "Operations",
  accounts: "Accounts",
  credit: "Credit",
  hr: "HR",
  internal_audit: "Internal Audit",
  system: "System",
  me: "My HR",
};

export type UsageFilters = {
  from: string;
  to: string;
  staff: string | null;
  branch: string | null;
  department: string | null;
  role: string | null;
};

export type UsageEvent = {
  occurred_at: string;
  kind: UsageKind;
  staff_id: string | null;
  staff_name: string | null;
  branch_id: string | null;
  path: string | null;
  module: string | null;
  label: string | null;
  detail: Record<string, unknown>;
  user_agent: string | null;
  ip: string | null;
};

export type PersonUsage = {
  staff_id: string;
  full_name: string;
  department_code: string;
  branch_id: string | null;
  sign_ins: number;
  failed_sign_ins: number;
  page_views: number;
  changes: number;
  downloads: number;
  active_days: number;
  last_seen: string | null;
};

export type PageUsage = { module: string | null; label: string; views: number; people: number; last_opened: string };
export type DayUsage = { day: string; people: number; sign_ins: number; page_views: number; changes: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_]{0,40}$/;

/** Today in Lagos (UTC+1, no daylight saving), which is how usage is grouped into days. */
export function lagosToday(now = new Date()): string {
  return new Date(now.getTime() + 3600_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Reads the filters from the query string. Defaults to the last 7 days; anything malformed is ignored. */
export function parseUsageFilters(params: Record<string, string | string[] | undefined>, now = new Date()): UsageFilters {
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string).trim() : "");
  const to = ISO_DATE.test(get("to")) ? get("to") : lagosToday(now);
  const from = ISO_DATE.test(get("from")) && get("from") <= to ? get("from") : addDays(to, -6);
  return {
    from,
    to,
    staff: UUID.test(get("staff")) ? get("staff") : null,
    branch: UUID.test(get("branch")) ? get("branch") : null,
    department: CODE.test(get("department")) ? get("department") : null,
    role: CODE.test(get("role")) ? get("role") : null,
  };
}

export function usageQuery(filters: UsageFilters, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams({ from: filters.from, to: filters.to });
  for (const [k, v] of Object.entries({ staff: filters.staff, branch: filters.branch, department: filters.department, role: filters.role, ...extra }))
    if (v) q.set(k, v);
  return q.toString();
}

const args = (f: UsageFilters) => ({
  p_from: f.from,
  p_to: f.to,
  p_branch: f.branch,
  p_department: f.department,
  p_role: f.role,
});

export async function loadUsage(supabase: SupabaseClient, f: UsageFilters) {
  const [people, pages, days] = await Promise.all([
    supabase.rpc("usage_by_person", args(f)),
    supabase.rpc("usage_by_page", { ...args(f), p_staff: f.staff }),
    supabase.rpc("usage_by_day", { ...args(f), p_staff: f.staff }),
  ]);
  for (const r of [people, pages, days]) if (r.error) throw dbFailure(r.error);
  const num = <T extends object>(rows: T[], keys: (keyof T)[]) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k] ?? 0)])) }) as T);
  return {
    people: num(people.data as PersonUsage[], ["sign_ins", "failed_sign_ins", "page_views", "changes", "downloads", "active_days"]),
    pages: num(pages.data as PageUsage[], ["views", "people"]),
    days: num(days.data as DayUsage[], ["people", "sign_ins", "page_views", "changes"]),
  };
}

export async function loadUsageEvents(
  supabase: SupabaseClient,
  f: UsageFilters,
  opts: { kind?: string; limit?: number; offset?: number } = {},
): Promise<UsageEvent[]> {
  const { data, error } = await supabase.rpc("usage_events", {
    ...args(f),
    p_staff: f.staff,
    p_kind: opts.kind && opts.kind in USAGE_KINDS ? opts.kind : "all",
    p_limit: opts.limit ?? 100,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw dbFailure(error);
  return data as UsageEvent[];
}

/** What happened, in words: "Members · open record", "Changed Loans (status)", "Audit trail (XLSX)". */
export function describeEvent(e: Pick<UsageEvent, "kind" | "label" | "detail">): string {
  if (e.kind === "change") {
    const table = String(e.detail.table ?? "");
    const action = { INSERT: "Created", UPDATE: "Changed", DELETE: "Deleted" }[String(e.detail.action)] ?? "Changed";
    const fields = Array.isArray(e.detail.fields) ? (e.detail.fields as string[]).filter((x) => x !== "updated_at") : [];
    return `${action} ${AUDITED_TABLES[table] ?? table.replace(/_/g, " ")}${fields.length ? ` (${fields.slice(0, 4).join(", ")}${fields.length > 4 ? ", …" : ""})` : ""}`;
  }
  if (e.kind === "sign_in_failed") return "Wrong email or password";
  return e.label ?? USAGE_KINDS[e.kind] ?? e.kind;
}
