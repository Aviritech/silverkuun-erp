import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";

export type BranchTarget = { branch_id: string; month: string; registrations: number; collections: string };

/** Targets for every month that starts within [from, to], keyed by `${branch_id}:${YYYY-MM-01}`. */
export async function loadTargets(supabase: SupabaseClient, from: string, to: string): Promise<Map<string, BranchTarget>> {
  const { data, error } = await supabase
    .from("branch_targets")
    .select("branch_id, month, registrations, collections")
    .gte("month", `${from.slice(0, 7)}-01`)
    .lte("month", to);
  if (error) throw dbFailure(error);
  return new Map((data as BranchTarget[]).map((t) => [`${t.branch_id}:${t.month}`, t]));
}

export function percent(actual: number, target: number | null | undefined): string | null {
  if (!target) return null;
  return `${Math.round((actual / target) * 100)}%`;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Each branch's targets for a month (YYYY-MM) against registrations and net collections. */
export async function targetAchievement(supabase: SupabaseClient, month: string) {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const [{ data, error }, branches, targets] = await Promise.all([
    supabase.rpc("branch_operations", { p_from: from, p_to: to, p_grain: "month" }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    loadTargets(supabase, from, to),
  ]);
  if (error) throw dbFailure(error);
  if (branches.error) throw dbFailure(branches.error);
  const actuals = new Map(
    (data as { branch_id: string; registrations: number; contributions_total: string }[]).map((a) => [a.branch_id, a]),
  );
  return branches.data.map((b) => {
    const t = targets.get(`${b.id}:${from}`);
    const a = actuals.get(b.id);
    const collections = Number(a?.contributions_total ?? 0);
    const registrations = Number(a?.registrations ?? 0);
    return {
      branch_id: b.id,
      branch_name: b.name,
      target_registrations: t?.registrations ?? null,
      registrations,
      registrations_pct: percent(registrations, t?.registrations),
      target_collections: t ? Number(t.collections) : null,
      collections,
      collections_pct: percent(collections, t ? Number(t.collections) : null),
    };
  });
}
