import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";
import type { ReportDefinition, Row } from "@/lib/reports/types";
import { MEMBER_STATUSES, type MemberStatus } from "@/modules/administration/constants";
import {
  AUDITED_TABLES,
  EXCEPTION_CATEGORIES,
  LARGE_TRANSACTION_NAIRA,
  SEVERITIES,
  recordHref,
  type ExceptionCategory,
  type Severity,
} from "./constants";

const n = (v: unknown) => Number(v ?? 0);

async function branchNames(supabase: SupabaseClient): Promise<Map<string, { name: string; region_id: string }>> {
  const { data, error } = await supabase.from("branches").select("id, name, region_id");
  if (error) throw dbFailure(error);
  return new Map(data.map((b) => [b.id, b]));
}

export type AuditException = {
  category: ExceptionCategory;
  severity: Severity;
  branch_id: string | null;
  record_type: string;
  record_id: string | null;
  summary: string;
  detail: string | null;
  occurred_at: string | null;
};

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export async function loadExceptions(supabase: SupabaseClient): Promise<AuditException[]> {
  const { data, error } = await supabase.rpc("audit_exceptions", { p_large_amount: LARGE_TRANSACTION_NAIRA });
  if (error) throw dbFailure(error);
  return (data as AuditException[]).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""),
  );
}

const branchOperations: ReportDefinition = {
  key: "branch-operations",
  title: "Branch operations",
  description: "Registrations, approvals, collections and posted cash movements by branch, in daily, weekly or monthly periods.",
  basePath: "/internal-audit",
  permission: "module.internal_audit",
  dates: "period",
  branchFilter: true,
  options: [
    {
      name: "grain",
      label: "Period",
      choices: [
        { value: "month", label: "Monthly" },
        { value: "week", label: "Weekly" },
        { value: "day", label: "Daily" },
      ],
    },
  ],
  async run(supabase, f) {
    const { data, error } = await supabase.rpc("branch_operations", {
      p_from: f.from,
      p_to: f.to,
      p_grain: f.options.grain,
      p_branch_id: f.branch,
      p_region_id: f.region,
    });
    if (error) throw dbFailure(error);
    const rows = data as Row[];
    const sumKeys = ["registrations", "approvals", "contributions_count", "contributions_total", "top_ups_total", "reversals_total", "unverified_count", "receipts_total", "payments_total"];
    const total: Row = { period_start: null, branch_name: "Total", _kind: "total" };
    for (const k of sumKeys) total[k] = Math.round(rows.reduce((s, r) => s + n(r[k]), 0) * 100) / 100;
    return {
      columns: [
        { key: "period_start", label: "Period from", kind: "date" },
        { key: "branch_name", label: "Branch" },
        { key: "region_name", label: "Region" },
        { key: "registrations", label: "New files", kind: "number" },
        { key: "approvals", label: "Approved", kind: "number" },
        { key: "contributions_count", label: "Payments", kind: "number" },
        { key: "contributions_total", label: "Collected (net)", kind: "money" },
        { key: "top_ups_total", label: "Top-ups", kind: "money" },
        { key: "reversals_total", label: "Reversals", kind: "money" },
        { key: "unverified_count", label: "Unverified", kind: "number" },
        { key: "receipts_total", label: "Receipts posted", kind: "money" },
        { key: "payments_total", label: "Payments posted", kind: "money" },
      ],
      rows: [...rows, total],
    };
  },
};

const customerRegister: ReportDefinition = {
  key: "customer-register",
  title: "Customer register",
  description: "Every member file with its KYC completeness, plans, contributions and changes after approval.",
  basePath: "/internal-audit",
  permission: "module.internal_audit",
  dates: "none",
  branchFilter: true,
  options: [
    {
      name: "status",
      label: "Status",
      choices: [{ value: "all", label: "All statuses" }].concat(
        (Object.keys(MEMBER_STATUSES) as MemberStatus[]).map((s) => ({ value: s, label: MEMBER_STATUSES[s].label })),
      ),
    },
    {
      name: "kyc",
      label: "KYC",
      choices: [
        { value: "all", label: "Complete and incomplete" },
        { value: "incomplete", label: "Incomplete only" },
      ],
    },
  ],
  async run(supabase, f) {
    const [{ data, error }, branches] = await Promise.all([
      supabase.rpc("customer_register", { p_branch_id: f.branch, p_region_id: f.region }),
      branchNames(supabase),
    ]);
    if (error) throw dbFailure(error);
    const list = (data as (Row & { status: MemberStatus; member_id: string; branch_id: string; missing_documents: string | null })[]).filter(
      (m) => (f.options.status === "all" || m.status === f.options.status) && (f.options.kyc === "all" || m.missing_documents),
    );
    return {
      columns: [
        { key: "member_name", label: "Member" },
        { key: "membership_no", label: "Membership no." },
        { key: "branch", label: "Branch" },
        { key: "status_label", label: "Status" },
        { key: "nin", label: "NIN" },
        { key: "phone", label: "Phone" },
        { key: "missing_documents", label: "Missing KYC" },
        { key: "plan_count", label: "Plans", kind: "number" },
        { key: "total_contributed", label: "Contributed", kind: "money" },
        { key: "total_verified", label: "Verified", kind: "money" },
        { key: "unverified_count", label: "Unverified", kind: "number" },
        { key: "last_paid_on", label: "Last paid", kind: "date" },
        { key: "amendments", label: "Changes after approval", kind: "number" },
        { key: "created_at", label: "Created", kind: "date" },
      ],
      rows: list.map((m) => ({
        ...m,
        branch: branches.get(m.branch_id)?.name ?? "",
        status_label: MEMBER_STATUSES[m.status].label,
        missing_documents: m.missing_documents?.replaceAll("_", " ") ?? "",
        created_at: String(m.created_at).slice(0, 10),
        _href: `/administration/members/${m.member_id}`,
      })),
    };
  },
};

const exceptions: ReportDefinition = {
  key: "exceptions",
  title: "Exceptions",
  description:
    "Compliance exceptions found across every branch you oversee: incomplete KYC, unusual and large transactions, adjustments, control breaches and unreconciled items.",
  basePath: "/internal-audit",
  permission: "module.internal_audit",
  dates: "none",
  branchFilter: true,
  options: [
    {
      name: "severity",
      label: "Severity",
      choices: [{ value: "all", label: "All severities" }].concat(
        (Object.keys(SEVERITIES) as Severity[]).map((s) => ({ value: s, label: SEVERITIES[s].label })),
      ),
    },
    {
      name: "category",
      label: "Type",
      choices: [{ value: "all", label: "All types" }].concat(
        (Object.keys(EXCEPTION_CATEGORIES) as ExceptionCategory[]).map((c) => ({ value: c, label: EXCEPTION_CATEGORIES[c] })),
      ),
    },
  ],
  async run(supabase, f) {
    const [list, branches] = await Promise.all([loadExceptions(supabase), branchNames(supabase)]);
    const rows = list
      .filter((e) => f.options.severity === "all" || e.severity === f.options.severity)
      .filter((e) => f.options.category === "all" || e.category === f.options.category)
      .filter((e) => !f.branch || e.branch_id === f.branch)
      .filter((e) => !f.region || (e.branch_id && branches.get(e.branch_id)?.region_id === f.region))
      .map((e) => ({
        summary: e.summary,
        severity: SEVERITIES[e.severity].label,
        category: EXCEPTION_CATEGORIES[e.category] ?? e.category,
        branch: e.branch_id ? (branches.get(e.branch_id)?.name ?? "") : "Organisation",
        detail: e.detail,
        occurred_at: e.occurred_at,
        _href: recordHref(e.record_type, e.record_id),
      }));
    return {
      columns: [
        { key: "summary", label: "Exception" },
        { key: "severity", label: "Severity" },
        { key: "category", label: "Type" },
        { key: "branch", label: "Branch" },
        { key: "detail", label: "Detail" },
        { key: "occurred_at", label: "When", kind: "datetime" },
      ],
      rows,
      notes: [
        `Large transactions are those of ₦${LARGE_TRANSACTION_NAIRA.toLocaleString("en-NG")} or more. Overdue loan reports arrive with the Credit department's workflow.`,
      ],
    };
  },
};

const auditTrail: ReportDefinition = {
  key: "audit-trail",
  title: "Audit trail",
  description: "Every insert, change and deletion with who made it and when. Entries can't be edited or deleted.",
  basePath: "/internal-audit",
  permission: "audit.trail.read",
  dates: "period",
  branchFilter: true,
  options: [
    {
      name: "table",
      label: "Record type",
      choices: [{ value: "all", label: "All records" }].concat(Object.entries(AUDITED_TABLES).map(([value, label]) => ({ value, label }))),
    },
    {
      name: "action",
      label: "Action",
      choices: [
        { value: "all", label: "All actions" },
        { value: "INSERT", label: "Created" },
        { value: "UPDATE", label: "Changed" },
        { value: "DELETE", label: "Deleted" },
      ],
    },
  ],
  async run(supabase, f) {
    let query = supabase
      .from("audit_log")
      .select("id, occurred_at, actor_id, table_name, record_id, branch_id, action, changed_fields")
      .gte("occurred_at", `${f.from}T00:00:00Z`)
      .lte("occurred_at", `${f.to}T23:59:59.999Z`)
      .order("occurred_at", { ascending: false })
      .limit(5000);
    if (f.options.table !== "all") query = query.eq("table_name", `public.${f.options.table}`);
    if (f.options.action !== "all") query = query.eq("action", f.options.action);
    const branches = await branchNames(supabase);
    if (f.branch) query = query.eq("branch_id", f.branch);
    else if (f.region) query = query.in("branch_id", [...branches].filter(([, b]) => b.region_id === f.region).map(([id]) => id));
    const { data, error } = await query;
    if (error) throw dbFailure(error);
    const actorIds = [...new Set(data.map((e) => e.actor_id).filter(Boolean))];
    const { data: actors } = actorIds.length ? await supabase.rpc("staff_display_names", { p_ids: actorIds }) : { data: [] };
    const actorName = new Map(((actors ?? []) as { id: string; full_name: string }[]).map((a) => [a.id, a.full_name]));
    const ACTIONS: Record<string, string> = { INSERT: "Created", UPDATE: "Changed", DELETE: "Deleted" };
    return {
      columns: [
        { key: "occurred_at", label: "When", kind: "datetime" },
        { key: "action", label: "Action" },
        { key: "record", label: "Record type" },
        { key: "record_id", label: "Record" },
        { key: "fields", label: "Fields changed" },
        { key: "branch", label: "Branch" },
        { key: "actor", label: "By" },
      ],
      rows: data.map((e) => {
        const table = e.table_name.replace("public.", "");
        return {
          occurred_at: e.occurred_at,
          action: ACTIONS[e.action] ?? e.action,
          record: AUDITED_TABLES[table] ?? table,
          record_id: e.record_id,
          fields: e.changed_fields?.filter((x: string) => x !== "updated_at").join(", ") ?? "",
          branch: e.branch_id ? (branches.get(e.branch_id)?.name ?? "") : "",
          actor: e.actor_id ? (actorName.get(e.actor_id) ?? e.actor_id) : "System",
          _href: e.record_id ? `/internal-audit/trace/${e.record_id}` : undefined,
        };
      }),
      notes: data.length === 5000 ? ["Showing the latest 5,000 entries. Narrow the dates to see older ones."] : [],
    };
  },
};

export const internalAuditReports: ReportDefinition[] = [exceptions, branchOperations, customerRegister, auditTrail];
