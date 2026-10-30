"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "./constants";
import { administrationModule } from "./module";
import {
  amendmentSchema,
  approvalSchema,
  contributionSchema,
  documentSchema,
  fieldErrors,
  issueSchema,
  marketerReviewSchema,
  memberSchema,
  planSchema,
  returnSchema,
  reversalSchema,
  targetSchema,
} from "./schemas";

export type { ActionState };

const MEMBER_FIELDS = [
  "branch_id",
  "title",
  "first_name",
  "middle_name",
  "last_name",
  "date_of_birth",
  "gender",
  "phone",
  "email",
  "address",
  "nin",
  "id_type",
  "id_number",
  "next_of_kin_name",
  "next_of_kin_phone",
  "next_of_kin_relationship",
] as const;

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

function memberPath(memberId: string) {
  return `/administration/members/${memberId}`;
}

export async function createMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = memberSchema.safeParse(formObject(formData, MEMBER_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("members").insert(parsed.data).select("id").single();
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/administration", "layout");
  redirect(memberPath(data.id));
}

export async function updateMember(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = memberSchema.omit({ branch_id: true }).safeParse(formObject(formData, MEMBER_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: current } = await supabase.from("members").select("status").eq("id", memberId).maybeSingle();
  if (!current) return { error: "Member not found." };

  let update: Record<string, unknown> = parsed.data;
  if (current.status === "approved") {
    const reason = amendmentSchema.safeParse({ amendment_reason: formData.get("amendment_reason") ?? "" });
    if (!reason.success) return { fieldErrors: fieldErrors(reason.error) };
    update = { ...update, amendment_reason: reason.data.amendment_reason };
  }

  const { data, error } = await supabase.from("members").update(update).eq("id", memberId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't edit this member right now." };

  revalidatePath(memberPath(memberId));
  redirect(memberPath(memberId));
}

export async function uploadDocument(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = documentSchema.safeParse({ document_type: formData.get("document_type") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Choose a file to upload" } };
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return { fieldErrors: { file: "Upload a PDF, JPEG or PNG" } };
  }
  if (file.size > MAX_UPLOAD_BYTES) return { fieldErrors: { file: "Files can be at most 10 MB" } };

  const supabase = await createClient();
  const { data: member } = await supabase.from("members").select("id, branch_id").eq("id", memberId).maybeSingle();
  if (!member) return { error: "Member not found." };

  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-100);
  const storagePath = `${member.branch_id}/${member.id}/${randomUUID()}-${safeName}`;

  const upload = await supabase.storage
    .from("member-documents")
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (upload.error) return { error: friendlyDbError({ message: upload.error.message }) };

  const { error } = await supabase.from("member_documents").insert({
    member_id: member.id,
    branch_id: member.branch_id,
    document_type: parsed.data.document_type,
    file_name: file.name.slice(0, 200),
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(memberPath(memberId));
  return { ok: true };
}

export async function removeDocument(memberId: string, documentId: string): Promise<ActionState> {
  await requireModule(administrationModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_documents").delete().eq("id", documentId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't remove this document." };
  revalidatePath(memberPath(memberId));
  return { ok: true };
}

export async function sendToMarketer(memberId: string): Promise<ActionState> {
  await requireModule(administrationModule);
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_member_to_marketer", { p_member_id: memberId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/administration", "layout");
  return { ok: true };
}

export async function marketerReview(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = marketerReviewSchema.safeParse({ note: formData.get("note") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("marketer_review_member", { p_member_id: memberId, p_note: parsed.data.note });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/administration", "layout");
  return { ok: true };
}

export async function submitMember(memberId: string): Promise<ActionState> {
  await requireModule(administrationModule);
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_member", { p_member_id: memberId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/administration", "layout");
  return { ok: true };
}

export async function approveMember(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = approvalSchema.safeParse({ signature: formData.get("signature") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_member", { p_member_id: memberId, p_signature: parsed.data.signature });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/administration", "layout");
  return { ok: true };
}

export async function returnMember(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = returnSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("return_member", { p_member_id: memberId, p_reason: parsed.data.reason });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/administration", "layout");
  return { ok: true };
}

export async function addPlan(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = planSchema.safeParse(
    formObject(formData, ["plan_type", "contribution_amount", "contribution_frequency", "start_date", "maturity_date"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: member } = await supabase.from("members").select("id, branch_id").eq("id", memberId).maybeSingle();
  if (!member) return { error: "Member not found." };

  const { error } = await supabase
    .from("member_plans")
    .insert({ ...parsed.data, member_id: member.id, branch_id: member.branch_id });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(memberPath(memberId));
  return { ok: true };
}

export async function recordContribution(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = contributionSchema.safeParse(
    formObject(formData, ["member_plan_id", "kind", "amount", "paid_on", "payment_method", "reference"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("member_plans")
    .select("id, member_id, branch_id")
    .eq("id", parsed.data.member_plan_id)
    .maybeSingle();
  if (!plan || plan.member_id !== memberId) return { error: "Plan not found." };

  // member_id and branch_id are overwritten from the plan by the database; they're sent only to satisfy NOT NULL.
  const { error } = await supabase
    .from("contributions")
    .insert({ ...parsed.data, member_id: plan.member_id, branch_id: plan.branch_id });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(memberPath(memberId));
  return { ok: true };
}

export async function reverseContribution(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = reversalSchema.safeParse(formObject(formData, ["contribution_id", "notes"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: original } = await supabase
    .from("contributions")
    .select("id, member_plan_id, member_id, branch_id, amount, payment_method")
    .eq("id", parsed.data.contribution_id)
    .maybeSingle();
  if (!original || original.member_id !== memberId) return { error: "Entry not found." };

  const { error } = await supabase.from("contributions").insert({
    member_plan_id: original.member_plan_id,
    member_id: original.member_id,
    branch_id: original.branch_id,
    kind: "reversal",
    amount: -Number(original.amount),
    paid_on: new Date().toISOString().slice(0, 10),
    payment_method: original.payment_method,
    reverses_id: original.id,
    notes: parsed.data.notes,
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(memberPath(memberId));
  return { ok: true };
}

export async function verifyContribution(memberId: string, contributionId: string): Promise<ActionState> {
  await requireModule(administrationModule);
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_contribution", { p_contribution_id: contributionId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(memberPath(memberId));
  return { ok: true };
}

export async function recordDocumentIssue(
  memberId: string,
  documentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = issueSchema.safeParse(formObject(formData, ["issued_on", "issue_channel", "issue_note"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_document_issue", {
    p_document_id: documentId,
    p_issued_on: parsed.data.issued_on,
    p_channel: parsed.data.issue_channel,
    p_note: parsed.data.issue_note,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(memberPath(memberId));
  return { ok: true };
}

export async function saveBranchTarget(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(administrationModule);
  const parsed = targetSchema.safeParse(formObject(formData, ["branch_id", "month", "registrations", "collections"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { month, ...target } = parsed.data;
  const { data, error } = await supabase
    .from("branch_targets")
    .upsert({ ...target, month: `${month}-01` }, { onConflict: "branch_id,month" })
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't set targets for this branch." };
  revalidatePath("/administration/targets");
  return { ok: true, message: "Target saved." };
}
