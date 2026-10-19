import "server-only";
import type { PermissionSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { DocumentType, MemberStatus } from "./constants";
import { dbFailure } from "@/lib/db-errors";

export type Branch = { id: string; code: string; name: string; region_id: string };

export type Member = {
  id: string;
  branch_id: string;
  membership_no: string | null;
  status: MemberStatus;
  title: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  gender: "female" | "male" | null;
  phone: string;
  email: string | null;
  address: string;
  nin: string;
  id_type: string;
  id_number: string;
  next_of_kin_name: string | null;
  next_of_kin_phone: string | null;
  next_of_kin_relationship: string | null;
  return_reason: string | null;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

export type MemberDocument = {
  id: string;
  document_type: DocumentType;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
};

export type Plan = {
  id: string;
  plan_type: string;
  contribution_amount: string;
  contribution_frequency: string;
  start_date: string;
  maturity_date: string;
  status: string;
};

export type PlanTotals = {
  member_plan_id: string;
  total_contributed: string;
  total_verified: string;
  total_top_ups: string;
  unverified_count: number;
  last_paid_on: string | null;
};

export type Contribution = {
  id: string;
  member_plan_id: string;
  kind: "scheduled" | "top_up" | "reversal";
  amount: string;
  paid_on: string;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  reverses_id: string | null;
  recorded_by: string;
  recorded_at: string;
  verified_by: string | null;
  verified_at: string | null;
};

export function fullName(m: Pick<Member, "title" | "first_name" | "middle_name" | "last_name">): string {
  return [m.title, m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ");
}

export async function listBranches(): Promise<Branch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("branches").select("id, code, name, region_id").eq("is_active", true).order("name");
  if (error) throw dbFailure(error);
  return data;
}

/** Branches where the staff member holds `permission`. */
export async function branchesWith(permissions: PermissionSet, permission: string): Promise<Branch[]> {
  return (await listBranches()).filter((b) => permissions.hasForBranch(permission, b));
}

export async function getMemberBundle(memberId: string) {
  const supabase = await createClient();
  const { data: member, error } = await supabase.from("members").select("*").eq("id", memberId).maybeSingle();
  if (error) throw dbFailure(error);
  if (!member) return null;

  const [documents, plans, totals, contributions, plansCatalog] = await Promise.all([
    supabase.from("member_documents").select("*").eq("member_id", memberId).order("uploaded_at"),
    supabase.from("member_plans").select("*").eq("member_id", memberId).order("start_date"),
    supabase.from("member_plan_totals").select("*").eq("member_id", memberId),
    supabase.from("contributions").select("*").eq("member_id", memberId).order("paid_on").order("recorded_at"),
    supabase.from("plan_types").select("code, name").eq("is_active", true).order("sort_order"),
  ]);
  for (const r of [documents, plans, totals, contributions, plansCatalog]) if (r.error) throw dbFailure(r.error);

  const docs = (documents.data ?? []) as MemberDocument[];
  const signed = docs.length
    ? await supabase.storage.from("member-documents").createSignedUrls(docs.map((d) => d.storage_path), 120)
    : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  const staffIds = [member.created_by, member.submitted_by, member.approved_by].filter(Boolean);
  const { data: staff } = staffIds.length
    ? await supabase.rpc("staff_display_names", { p_ids: staffIds })
    : { data: [] };
  const staffNames = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id as string, s.full_name as string]));

  return {
    member: member as Member,
    documents: docs.map((d) => ({ ...d, url: urls.get(d.storage_path) ?? null })),
    plans: (plans.data ?? []) as Plan[],
    totals: new Map(((totals.data ?? []) as PlanTotals[]).map((t) => [t.member_plan_id, t])),
    contributions: (contributions.data ?? []) as Contribution[],
    planTypes: (plansCatalog.data ?? []) as { code: string; name: string }[],
    staffName: (id: string | null) => (id ? (staffNames.get(id) ?? "Another staff member") : "—"),
  };
}

export async function memberCounts(): Promise<Record<MemberStatus, number>> {
  const supabase = await createClient();
  const statuses: MemberStatus[] = ["draft", "pending_approval", "returned", "approved"];
  const results = await Promise.all(
    statuses.map((s) => supabase.from("members").select("id", { count: "exact", head: true }).eq("status", s)),
  );
  for (const r of results) if (r.error) throw dbFailure(r.error);
  return Object.fromEntries(statuses.map((s, i) => [s, results[i].count ?? 0])) as Record<MemberStatus, number>;
}
