import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import type { ReportDefinition, ReportFilters, Row } from "@/lib/reports/types";
import { branchNames, customerRegister } from "@/modules/internal-audit/reports";
import { DOCUMENT_TYPES, FREQUENCIES, ISSUE_CHANNELS, ISSUED_DOCUMENT_TYPES, type DocumentType } from "./constants";

const n = (v: unknown) => Number(v ?? 0);
const round = (v: number) => Math.round(v * 100) / 100;

type Progress = {
  plan_id: string;
  member_id: string;
  branch_id: string;
  plan_type: string;
  contribution_amount: string;
  contribution_frequency: keyof typeof FREQUENCIES;
  start_date: string;
  maturity_date: string;
  status: string;
  member_name: string;
  membership_no: string | null;
  installments_due: number;
  expected_to_date: string;
  scheduled_paid: string;
  top_ups: string;
  total_contributed: string;
  total_verified: string;
  outstanding: string;
  last_paid_on: string | null;
  days_to_maturity: number;
};

async function planProgress(supabase: SupabaseClient, f: ReportFilters, branches: Map<string, { region_id: string }>) {
  let query = supabase.from("plan_progress").select("*").order("member_name").limit(10000);
  if (f.branch) query = query.eq("branch_id", f.branch);
  else if (f.region) query = query.in("branch_id", [...branches].filter(([, b]) => b.region_id === f.region).map(([id]) => id));
  if (f.product) query = query.eq("plan_type", f.product);
  const { data, error } = await query;
  if (error) throw dbFailure(error);
  return data as Progress[];
}

async function planNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("plan_types").select("code, name");
  if (error) throw dbFailure(error);
  return new Map(data.map((p) => [p.code, p.name]));
}

const contributionSchedule: ReportDefinition = {
  key: "contribution-schedule",
  title: "Contribution schedule",
  description:
    "Every plan with what it should have received by today, what was paid, top-ups and the amount outstanding. Replaces the branch Excel schedule.",
  basePath: "/administration",
  permission: "members.read",
  dates: "none",
  branchFilter: true,
  dimensionFilters: ["product"],
  options: [
    {
      name: "show",
      label: "Show",
      choices: [
        { value: "active", label: "Active plans" },
        { value: "behind", label: "Behind on payments" },
        { value: "all", label: "All plans" },
      ],
    },
  ],
  async run(supabase, f) {
    const branches = await branchNames(supabase);
    const [list, plans] = await Promise.all([planProgress(supabase, f, branches), planNames(supabase)]);
    const rows = list
      .filter((p) => f.options.show === "all" || p.status === "active")
      .filter((p) => f.options.show !== "behind" || n(p.outstanding) > 0);
    const keys = ["expected_to_date", "scheduled_paid", "top_ups", "total_contributed", "outstanding"];
    const total: Row = { member_name: "Total", _kind: "total" };
    for (const k of keys) total[k] = round(rows.reduce((s, r) => s + n(r[k as keyof Progress]), 0));
    return {
      columns: [
        { key: "member_name", label: "Member" },
        { key: "membership_no", label: "Membership no." },
        { key: "branch", label: "Branch" },
        { key: "plan", label: "Plan" },
        { key: "contribution_amount", label: "Amount", kind: "money" },
        { key: "frequency", label: "How often" },
        { key: "start_date", label: "Start", kind: "date" },
        { key: "maturity_date", label: "Maturity", kind: "date" },
        { key: "installments_due", label: "Due so far", kind: "number" },
        { key: "expected_to_date", label: "Expected to date", kind: "money" },
        { key: "scheduled_paid", label: "Paid", kind: "money" },
        { key: "top_ups", label: "Top-ups", kind: "money" },
        { key: "total_contributed", label: "Total contributed", kind: "money" },
        { key: "outstanding", label: "Outstanding", kind: "money" },
        { key: "last_paid_on", label: "Last paid", kind: "date" },
      ],
      rows: [
        ...rows.map((p) => ({
          ...p,
          branch: branches.get(p.branch_id)?.name ?? "",
          plan: plans.get(p.plan_type) ?? p.plan_type,
          frequency: FREQUENCIES[p.contribution_frequency] ?? p.contribution_frequency,
          _href: `/administration/members/${p.member_id}`,
        })),
        total,
      ],
      notes: [
        "Expected to date counts one contribution per period from the start date up to today or maturity. Top-ups don't reduce what is outstanding.",
      ],
    };
  },
};

const maturities: ReportDefinition = {
  key: "maturities",
  title: "Plans at or near maturity",
  description: "Plans maturing soon or already matured, with what the member has contributed and whether a maturity letter has been issued.",
  basePath: "/administration",
  permission: "members.read",
  dates: "none",
  branchFilter: true,
  dimensionFilters: ["product"],
  options: [
    {
      name: "window",
      label: "Maturing",
      choices: [
        { value: "60", label: "Matured or within 60 days" },
        { value: "30", label: "Matured or within 30 days" },
        { value: "90", label: "Matured or within 90 days" },
        { value: "matured", label: "Already matured" },
        { value: "all", label: "All plans" },
      ],
    },
  ],
  async run(supabase, f) {
    const branches = await branchNames(supabase);
    const [list, plans] = await Promise.all([planProgress(supabase, f, branches), planNames(supabase)]);
    const limit = f.options.window === "all" ? Infinity : f.options.window === "matured" ? 0 : Number(f.options.window);
    const due = list.filter((p) => ["active", "matured"].includes(p.status) && p.days_to_maturity <= limit);

    const memberIds = [...new Set(due.map((p) => p.member_id))];
    const letters = new Map<string, string | null>();
    if (memberIds.length) {
      const { data, error } = await supabase
        .from("member_documents")
        .select("member_id, issued_on")
        .eq("document_type", "maturity_letter")
        .in("member_id", memberIds);
      if (error) throw dbFailure(error);
      for (const d of data) if (!letters.get(d.member_id)) letters.set(d.member_id, d.issued_on);
    }

    return {
      columns: [
        { key: "member_name", label: "Member" },
        { key: "membership_no", label: "Membership no." },
        { key: "branch", label: "Branch" },
        { key: "plan", label: "Plan" },
        { key: "maturity_date", label: "Maturity", kind: "date" },
        { key: "when", label: "When" },
        { key: "total_contributed", label: "Contributed", kind: "money" },
        { key: "total_verified", label: "Verified", kind: "money" },
        { key: "outstanding", label: "Outstanding", kind: "money" },
        { key: "letter", label: "Maturity letter" },
      ],
      rows: due
        .sort((a, b) => a.days_to_maturity - b.days_to_maturity)
        .map((p) => ({
          ...p,
          branch: branches.get(p.branch_id)?.name ?? "",
          plan: plans.get(p.plan_type) ?? p.plan_type,
          when:
            p.days_to_maturity < 0
              ? `Matured ${-p.days_to_maturity} days ago`
              : p.days_to_maturity === 0
                ? "Matures today"
                : `In ${p.days_to_maturity} days`,
          letter: !letters.has(p.member_id) ? "Not prepared" : letters.get(p.member_id) ? `Issued ${formatDate(letters.get(p.member_id))}` : "Uploaded, not issued",
          _href: `/administration/members/${p.member_id}`,
        })),
      notes: [
        "The amount due to the member at maturity needs the Society's return calculation per plan, which Kuun is confirming. Upload the maturity letter on the member's file and record when it was issued.",
      ],
    };
  },
};

const issuedDocuments: ReportDefinition = {
  key: "issued-documents",
  title: "Issued letters and statements",
  description: "Agreement letters, statements of account and maturity letters on members' files: when each was issued, how and by whom.",
  basePath: "/administration",
  permission: "members.read",
  dates: "none",
  branchFilter: true,
  options: [
    {
      name: "state",
      label: "Status",
      choices: [
        { value: "all", label: "Issued and awaiting issue" },
        { value: "awaiting", label: "Awaiting issue" },
        { value: "issued", label: "Issued" },
      ],
    },
    {
      name: "type",
      label: "Document",
      choices: [{ value: "all", label: "All letters and statements" }].concat(
        ISSUED_DOCUMENT_TYPES.map((t) => ({ value: t, label: DOCUMENT_TYPES[t] })),
      ),
    },
  ],
  async run(supabase, f) {
    const branches = await branchNames(supabase);
    let query = supabase
      .from("member_documents")
      .select("id, member_id, branch_id, document_type, file_name, uploaded_at, issued_on, issued_by, issue_channel, issue_note, members(first_name, last_name, membership_no)")
      .in("document_type", f.options.type === "all" ? ISSUED_DOCUMENT_TYPES : [f.options.type])
      .order("uploaded_at", { ascending: false })
      .limit(5000);
    if (f.branch) query = query.eq("branch_id", f.branch);
    else if (f.region) query = query.in("branch_id", [...branches].filter(([, b]) => b.region_id === f.region).map(([id]) => id));
    if (f.options.state === "issued") query = query.not("issued_on", "is", null);
    if (f.options.state === "awaiting") query = query.is("issued_on", null);
    const { data, error } = await query;
    if (error) throw dbFailure(error);
    type D = {
      member_id: string; branch_id: string; document_type: DocumentType; file_name: string; uploaded_at: string;
      issued_on: string | null; issued_by: string | null; issue_channel: keyof typeof ISSUE_CHANNELS | null; issue_note: string | null;
      members: { first_name: string; last_name: string; membership_no: string | null };
    };
    const list = data as unknown as D[];
    const ids = [...new Set(list.map((d) => d.issued_by).filter(Boolean))];
    const { data: staff } = ids.length ? await supabase.rpc("staff_display_names", { p_ids: ids }) : { data: [] };
    const names = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
    return {
      columns: [
        { key: "member", label: "Member" },
        { key: "membership_no", label: "Membership no." },
        { key: "branch", label: "Branch" },
        { key: "document", label: "Document" },
        { key: "uploaded_at", label: "Uploaded", kind: "date" },
        { key: "issued_on", label: "Issued", kind: "date" },
        { key: "channel", label: "How" },
        { key: "issued_by", label: "Issued by" },
        { key: "issue_note", label: "Note" },
      ],
      rows: list.map((d) => ({
        member: `${d.members.first_name} ${d.members.last_name}`,
        membership_no: d.members.membership_no,
        branch: branches.get(d.branch_id)?.name ?? "",
        document: DOCUMENT_TYPES[d.document_type],
        uploaded_at: d.uploaded_at.slice(0, 10),
        issued_on: d.issued_on,
        channel: d.issue_channel ? ISSUE_CHANNELS[d.issue_channel] : "Not issued",
        issued_by: d.issued_by ? (names.get(d.issued_by) ?? "") : "",
        issue_note: d.issue_note,
        _href: `/administration/members/${d.member_id}`,
      })),
    };
  },
};

/** The Internal Audit customer register, for Administration. Changes after approval are left to Internal Audit. */
const memberRegister: ReportDefinition = {
  ...customerRegister,
  key: "member-register",
  title: "Member register",
  basePath: "/administration",
  permission: "members.read",
  description: "Every member file with its KYC completeness, plans and contributions.",
  async run(supabase, f) {
    const result = await customerRegister.run(supabase, f);
    return { ...result, columns: result.columns.filter((c) => c.key !== "amendments") };
  },
};

export const administrationReports: ReportDefinition[] = [contributionSchedule, maturities, issuedDocuments, memberRegister];
