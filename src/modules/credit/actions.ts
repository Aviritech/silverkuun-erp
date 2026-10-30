"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { ALLOWED_LOAN_UPLOAD_TYPES, MAX_LOAN_UPLOAD_BYTES } from "./constants";
import { creditModule } from "./module";
import {
  appraisalSchema,
  businessDecisionSchema,
  collateralSchema,
  decisionSchema,
  guarantorConfirmationSchema,
  guarantorSchema,
  loanDocumentSchema,
  loanSchema,
  productSchema,
  reasonSchema,
  reminderSchema,
  restructureDecisionSchema,
  restructureSchema,
} from "./schemas";

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

const loanPath = (id: string) => `/credit/loans/${id}`;

async function run(fn: string, args: Record<string, unknown>, loanId: string): Promise<ActionState> {
  await requireModule(creditModule);
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/credit", "layout");
  revalidatePath(loanPath(loanId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

const LOAN_FIELDS = [
  "member_id",
  "product_code",
  "account_officer_id",
  "phone",
  "address",
  "customer_category",
  "employer_name",
  "occupation",
  "employer_address",
  "monthly_income",
  "amount_requested",
  "purpose",
  "tenor_months",
  "repayment_frequency",
  "interest_rate",
  "rate_basis",
  "interest_method",
  "repayment_mode",
  "first_repayment_date",
] as const;

export async function saveLoan(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(creditModule);
  const parsed = loanSchema.safeParse(formObject(formData, LOAN_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();

  if (id) {
    const { member_id: _m, ...changes } = parsed.data;
    const { data, error } = await supabase.from("loans").update(changes).eq("id", id).select("id");
    if (error) return { error: friendlyDbError(error) };
    if (!data?.length) return { error: "You can't edit this application right now." };
    revalidatePath(loanPath(id));
    redirect(loanPath(id));
  }

  const { data: member } = await supabase.from("members").select("branch_id").eq("id", parsed.data.member_id).maybeSingle();
  if (!member) return { fieldErrors: { member_id: "Choose an approved member" } };
  // branch_id is set from the member by the database; it is sent only to satisfy NOT NULL.
  const { data, error } = await supabase
    .from("loans")
    .insert({ ...parsed.data, branch_id: member.branch_id, loan_no: "pending" })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/credit", "layout");
  redirect(loanPath(data.id));
}

export async function addGuarantor(loanId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(creditModule);
  const parsed = guarantorSchema.safeParse(
    formObject(formData, ["full_name", "phone", "address", "relationship", "occupation", "employer", "monthly_income", "is_member"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: loan } = await supabase.from("loans").select("branch_id").eq("id", loanId).maybeSingle();
  if (!loan) return { error: "Loan not found." };
  const { error } = await supabase.from("loan_guarantors").insert({ ...parsed.data, loan_id: loanId, branch_id: loan.branch_id });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(loanPath(loanId));
  return { ok: true };
}

export async function addCollateral(loanId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(creditModule);
  const parsed = collateralSchema.safeParse(formObject(formData, ["collateral_type", "description", "estimated_value", "valuation_date", "valued_by"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: loan } = await supabase.from("loans").select("branch_id").eq("id", loanId).maybeSingle();
  if (!loan) return { error: "Loan not found." };
  const { error } = await supabase.from("loan_collaterals").insert({ ...parsed.data, loan_id: loanId, branch_id: loan.branch_id });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(loanPath(loanId));
  return { ok: true };
}

export async function removeLoanPart(loanId: string, table: "loan_guarantors" | "loan_collaterals" | "loan_documents", id: string): Promise<ActionState> {
  await requireModule(creditModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).delete().eq("id", id).eq("loan_id", loanId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't remove this right now." };
  revalidatePath(loanPath(loanId));
  return { ok: true };
}

export async function uploadLoanDocument(loanId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(creditModule);
  const parsed = loanDocumentSchema.safeParse({ document_type: formData.get("document_type") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Choose a file to upload" } };
  if (!(ALLOWED_LOAN_UPLOAD_TYPES as readonly string[]).includes(file.type)) return { fieldErrors: { file: "Upload a PDF, JPEG or PNG" } };
  if (file.size > MAX_LOAN_UPLOAD_BYTES) return { fieldErrors: { file: "Files can be at most 10 MB" } };

  const supabase = await createClient();
  const { data: loan } = await supabase.from("loans").select("id, branch_id").eq("id", loanId).maybeSingle();
  if (!loan) return { error: "Loan not found." };
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-100);
  const storagePath = `${loan.branch_id}/${loan.id}/${randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from("loan-documents").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (upload.error) return { error: friendlyDbError({ message: upload.error.message }) };
  const { error } = await supabase.from("loan_documents").insert({
    loan_id: loan.id,
    branch_id: loan.branch_id,
    document_type: parsed.data.document_type,
    file_name: file.name.slice(0, 200),
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(loanPath(loanId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export async function submitLoan(id: string): Promise<ActionState> {
  return run("submit_loan", { p_loan_id: id }, id);
}

export async function appraiseLoan(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = appraisalSchema.safeParse(
    formObject(formData, ["bureau_check", "bureau_name", "bureau_score", "risk_rating", "recommendation", "recommended_amount", "notes"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  return run(
    "appraise_loan",
    {
      p_loan_id: id,
      p_bureau_check: v.bureau_check,
      p_bureau_name: v.bureau_name,
      p_bureau_score: v.bureau_score,
      p_risk_rating: v.risk_rating,
      p_recommendation: v.recommendation,
      p_recommended_amount: v.recommendation === "approve" ? v.recommended_amount : null,
      p_notes: v.notes,
    },
    id,
  );
}

export async function returnLoan(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return run("return_loan", { p_loan_id: id, p_reason: parsed.data.reason }, id);
}

export async function decideLoan(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = decisionSchema.safeParse(formObject(formData, ["decision", "approved_amount", "note"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const approve = parsed.data.decision === "approve";
  return run(
    "decide_loan",
    { p_loan_id: id, p_approve: approve, p_approved_amount: approve ? parsed.data.approved_amount : null, p_note: parsed.data.note },
    id,
  );
}

export async function businessDecideLoan(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = businessDecisionSchema.safeParse(formObject(formData, ["decision", "note"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return run("business_decide_loan", { p_loan_id: id, p_approve: parsed.data.decision === "approve", p_note: parsed.data.note }, id);
}

export async function confirmGuarantor(loanId: string, guarantorId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = guarantorConfirmationSchema.safeParse({ note: formData.get("note") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return run("confirm_loan_guarantor", { p_guarantor_id: guarantorId, p_note: parsed.data.note }, loanId);
}

export async function cancelLoan(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return run("cancel_loan", { p_loan_id: id, p_reason: parsed.data.reason }, id);
}

export async function reassignOfficer(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const officer = String(formData.get("account_officer_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(officer)) return { fieldErrors: { account_officer_id: "Choose an account officer" } };
  return run("reassign_loan_officer", { p_loan_id: id, p_officer_id: officer }, id);
}

export async function requestRestructure(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = restructureSchema.safeParse(
    formObject(formData, ["tenor_months", "repayment_frequency", "interest_rate", "rate_basis", "interest_method", "first_repayment_date", "reason"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  return run(
    "request_loan_restructure",
    {
      p_loan_id: id,
      p_tenor_months: v.tenor_months,
      p_frequency: v.repayment_frequency,
      p_interest_rate: v.interest_rate,
      p_rate_basis: v.rate_basis,
      p_interest_method: v.interest_method,
      p_first_due: v.first_repayment_date,
      p_reason: v.reason,
    },
    id,
  );
}

export async function decideRestructure(loanId: string, restructureId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = restructureDecisionSchema.safeParse(formObject(formData, ["decision", "note"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return run("decide_loan_restructure", { p_id: restructureId, p_approve: parsed.data.decision === "approve", p_note: parsed.data.note }, loanId);
}

export async function recordReminder(loanId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(creditModule);
  const parsed = reminderSchema.safeParse(formObject(formData, ["kind", "channel", "due_date", "amount", "note"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: loan } = await supabase.from("loans").select("branch_id").eq("id", loanId).maybeSingle();
  if (!loan) return { error: "Loan not found." };
  const { error } = await supabase.from("loan_reminders").insert({ ...parsed.data, loan_id: loanId, branch_id: loan.branch_id });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/credit/reminders");
  revalidatePath(loanPath(loanId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Loan products
// ---------------------------------------------------------------------------

const PRODUCT_FIELDS = [
  "code",
  "name",
  "description",
  "interest_rate",
  "rate_basis",
  "interest_method",
  "min_amount",
  "max_amount",
  "max_tenor_months",
  "requires_guarantor",
  "requires_collateral",
  "requires_proforma",
  "is_active",
] as const;

export async function saveProduct(code: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(creditModule);
  const parsed = productSchema.safeParse({ ...formObject(formData, PRODUCT_FIELDS), ...(code ? { code } : {}) });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { code: newCode, ...values } = parsed.data;
  const { data, error } = code
    ? await supabase.from("loan_products").update(values).eq("code", code).select("code")
    : await supabase.from("loan_products").insert({ code: newCode, ...values, sort_order: 100 }).select("code");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change loan products." };
  revalidatePath("/credit/products");
  return { ok: true };
}
