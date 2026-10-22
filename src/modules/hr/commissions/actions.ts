"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getCurrentStaff, requirePermission } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { rejectSchema, saleSchema, targetSchema } from "./schemas";

const targetPath = (id: string) => `/hr/commissions/${id}`;

function refresh(targetId?: string) {
  revalidatePath("/hr/commissions");
  if (targetId) revalidatePath(targetPath(targetId));
  revalidatePath("/me/commission");
}

const text = (formData: FormData, key: string) => (formData.get(key) as string | null) ?? "";

export async function createTarget(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("commission.manage");
  const parsed = targetSchema.safeParse({
    employee_id: text(formData, "employee_id"),
    name: text(formData, "name"),
    period_start: text(formData, "period_start"),
    period_end: text(formData, "period_end"),
    target_amount: text(formData, "target_amount"),
    method: text(formData, "method"),
    rate: text(formData, "rate"),
    flat_amount: text(formData, "flat_amount"),
    tier_upto: formData.getAll("tier_upto").map(String),
    tier_rate: formData.getAll("tier_rate").map(String),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("commission_targets").insert(parsed.data).select("id").single();
  if (error) return { error: friendlyDbError(error) };
  refresh();
  redirect(targetPath(data.id));
}

export async function cancelTarget(targetId: string): Promise<ActionState> {
  await requirePermission("commission.manage");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_targets")
    .update({ status: "cancelled" })
    .eq("id", targetId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't cancel this target." };
  refresh(targetId);
  return { ok: true };
}

export async function closeTarget(targetId: string): Promise<ActionState> {
  await requirePermission("commission.approve");
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_commission_target", { p_target_id: targetId });
  if (error) return { error: friendlyDbError(error) };
  refresh(targetId);
  revalidatePath("/hr/payroll", "layout");
  return { ok: true };
}

/** Records a sale. Employees use it for their own open targets; commission managers for anyone's. */
export async function recordSale(targetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = saleSchema.safeParse({
    client_name: text(formData, "client_name"),
    description: text(formData, "description"),
    amount: text(formData, "amount"),
    sale_date: text(formData, "sale_date"),
    reference: text(formData, "reference"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: target, error: targetError } = await supabase.from("commission_targets").select("employee_id").eq("id", targetId).maybeSingle();
  if (targetError) return { error: friendlyDbError(targetError) };
  if (!target) return { error: "That target can't be found." };

  // The database sets the employee, status and recorder; employee_id is sent only because the column is required.
  const { error } = await supabase.from("commission_sales").insert({ ...parsed.data, target_id: targetId, employee_id: target.employee_id });
  if (error) return { error: friendlyDbError(error) };
  refresh(targetId);
  return { ok: true, message: "Sale recorded. It counts once someone approves it." };
}

export async function removeSale(saleId: string, targetId: string): Promise<ActionState> {
  await getCurrentStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("commission_sales").delete().eq("id", saleId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only a pending sale you recorded can be removed." };
  refresh(targetId);
  return { ok: true };
}

export async function approveSale(saleId: string, targetId: string): Promise<ActionState> {
  await requirePermission("commission.approve");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_commission_sale", { p_sale_id: saleId, p_approve: true, p_note: null });
  if (error) return { error: friendlyDbError(error) };
  refresh(targetId);
  return { ok: true };
}

export async function rejectSale(saleId: string, targetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("commission.approve");
  const parsed = rejectSchema.safeParse({ note: text(formData, "note") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_commission_sale", { p_sale_id: saleId, p_approve: false, p_note: parsed.data.note });
  if (error) return { error: friendlyDbError(error) };
  refresh(targetId);
  return { ok: true };
}
