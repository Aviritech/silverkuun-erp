import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { Contribution, Member, Plan } from "./queries";

/** The member's name as the letters write it: first, middle and last name, in capitals. */
export function letterName(m: Pick<Member, "first_name" | "middle_name" | "last_name">): string {
  return [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ").toUpperCase();
}

export type LetterMember = Pick<
  Member,
  | "id"
  | "branch_id"
  | "membership_no"
  | "status"
  | "title"
  | "first_name"
  | "middle_name"
  | "last_name"
  | "address"
  | "bank_name"
  | "bank_account_no"
  | "interest_pay_day"
>;

const MEMBER_FIELDS =
  "id, branch_id, membership_no, status, title, first_name, middle_name, last_name, address, bank_name, bank_account_no, interest_pay_day";

/** The Branch Manager who signs the branch's letters, or null when the branch has none. */
export async function branchManagerName(branchId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("branch_manager_name", { p_branch_id: branchId });
  if (error) throw dbFailure(error);
  return (data as string | null) ?? null;
}

export async function getLetterMember(memberId: string): Promise<LetterMember | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").select(MEMBER_FIELDS).eq("id", memberId).maybeSingle();
  if (error) throw dbFailure(error);
  return (data as LetterMember | null) ?? null;
}

/** A plan with its member, plan name, contributions and the Branch Manager, for its agreement letter or statement. */
export async function getPlanLetter(planId: string) {
  const supabase = await createClient();
  const { data: plan, error } = await supabase.from("member_plans").select("*").eq("id", planId).maybeSingle();
  if (error) throw dbFailure(error);
  if (!plan) return null;
  const p = plan as Plan & { member_id: string; branch_id: string };

  const [member, type, contributions, manager] = await Promise.all([
    getLetterMember(p.member_id),
    supabase.from("plan_types").select("name").eq("code", p.plan_type).single(),
    supabase.from("contributions").select("*").eq("member_plan_id", planId).order("paid_on").order("recorded_at"),
    branchManagerName(p.branch_id),
  ]);
  for (const r of [type, contributions]) if (r.error) throw dbFailure(r.error);
  if (!member) return null;

  return {
    plan: p,
    planName: (type.data as { name: string }).name,
    member,
    contributions: (contributions.data ?? []) as Contribution[],
    manager,
  };
}

/** Contributions that still count: everything except reversals and the contributions they reverse. */
export function standingContributions(contributions: Contribution[]): Contribution[] {
  const reversed = new Set(contributions.filter((c) => c.reverses_id).map((c) => c.reverses_id));
  return contributions.filter((c) => c.kind !== "reversal" && !reversed.has(c.id));
}
