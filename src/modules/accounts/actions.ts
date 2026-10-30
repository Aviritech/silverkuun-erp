"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { ALLOWED_EVIDENCE_TYPES, MAX_EVIDENCE_BYTES, MAX_STATEMENT_BYTES, INTEREST_EXPENSE_ACCOUNT, ROI_PAYABLE_ACCOUNT } from "./constants";
import { accountsModule } from "./module";
import {
  accrualSchema,
  bankAccountSchema,
  billSchema,
  journalSchema,
  ledgerAccountSchema,
  mappingSchema,
  postingRuleSchema,
  reasonSchema,
  reconciliationSchema,
  supplierSchema,
  transactionSchema,
} from "./schemas";
import { parseStatement, parseStatementRows } from "./statement";
import { readXlsxRows } from "@/lib/files/xlsx";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function formObject(formData: FormData, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, (formData.get(k) as string | null) ?? ""]));
}

const txnPath = (id: string) => `/accounts/transactions/${id}`;
const bankPath = (id: string) => `/accounts/bank/${id}`;

function evidenceFileError(file: FormDataEntryValue | null): string | null {
  if (!(file instanceof File) || file.size === 0) return "Choose a file to upload";
  if (!(ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(file.type)) return "Upload a PDF, JPEG or PNG";
  if (file.size > MAX_EVIDENCE_BYTES) return "Files can be at most 10 MB";
  return null;
}

async function storeEvidence(
  supabase: Supabase,
  owner: { id: string; branch_id: string; bill?: boolean },
  file: File,
  kind: "supporting" | "payment_proof",
): Promise<string | null> {
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-100);
  const folder = owner.bill ? `${owner.branch_id}/bills/${owner.id}` : `${owner.branch_id}/${owner.id}`;
  const storagePath = `${folder}/${randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from("finance-evidence").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (upload.error) return friendlyDbError({ message: upload.error.message });
  const { error } = await supabase.from("finance_attachments").insert({
    ...(owner.bill ? { supplier_bill_id: owner.id } : { transaction_id: owner.id }),
    branch_id: owner.branch_id,
    kind,
    file_name: file.name.slice(0, 200),
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
  });
  return error ? friendlyDbError(error) : null;
}

// ---------------------------------------------------------------------------
// Receipts and payments
// ---------------------------------------------------------------------------

const TRANSACTION_FIELDS = [
  "direction",
  "transaction_type",
  "bank_account_id",
  "txn_date",
  "amount",
  "interest_amount",
  "member_id",
  "counterparty",
  "reference",
  "description",
  "statement_line_id",
  "department_code",
  "plan_type",
  "staff_id",
  "supplier_id",
  "supplier_bill_id",
  "loan_id",
  "currency",
  "foreign_amount",
  "fx_rate",
] as const;

export async function saveTransaction(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const parsed = transactionSchema.safeParse(formObject(formData, TRANSACTION_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile) {
    const problem = evidenceFileError(file);
    if (problem) return { fieldErrors: { file: problem } };
  }

  const supabase = await createClient();
  const { data: bank } = await supabase.from("bank_accounts").select("branch_id").eq("id", parsed.data.bank_account_id).maybeSingle();
  if (!bank) return { fieldErrors: { bank_account_id: "Choose the bank or cash account" } };
  // branch_id is set from the bank account by the database; it is sent only to satisfy NOT NULL.
  const values = { ...parsed.data, branch_id: bank.branch_id };

  let saved: { id: string; branch_id: string };
  if (id) {
    const { direction: _d, statement_line_id: _s, ...changes } = values;
    const { data, error } = await supabase.from("finance_transactions").update(changes).eq("id", id).select("id, branch_id");
    if (error) return { error: friendlyDbError(error) };
    if (!data?.length) return { error: "You can't edit this transaction right now." };
    saved = data[0];
  } else {
    const { data, error } = await supabase.from("finance_transactions").insert(values).select("id, branch_id").single();
    if (error) return { error: friendlyDbError(error) };
    saved = data;
  }
  if (hasFile) {
    const problem = await storeEvidence(supabase, saved, file as File, "supporting");
    if (problem) return { error: `Saved, but the evidence didn't upload: ${problem}` };
  }
  revalidatePath("/accounts", "layout");
  redirect(txnPath(saved.id));
}

export async function uploadEvidence(
  transactionId: string,
  kind: "supporting" | "payment_proof",
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireModule(accountsModule);
  const file = formData.get("file");
  const problem = evidenceFileError(file);
  if (problem) return { fieldErrors: { file: problem } };
  const supabase = await createClient();
  const { data: txn } = await supabase.from("finance_transactions").select("id, branch_id").eq("id", transactionId).maybeSingle();
  if (!txn) return { error: "Transaction not found." };
  const error = await storeEvidence(supabase, txn, file as File, kind);
  if (error) return { error };
  revalidatePath(txnPath(transactionId));
  return { ok: true };
}

async function runWorkflow(fn: string, args: Record<string, unknown>, path: string): Promise<ActionState> {
  await requireModule(accountsModule);
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/accounts", "layout");
  revalidatePath(path);
  return { ok: true };
}

export async function submitTransaction(id: string): Promise<ActionState> {
  return runWorkflow("submit_finance_transaction", { p_id: id }, txnPath(id));
}

export async function approveTransaction(id: string): Promise<ActionState> {
  return runWorkflow("approve_finance_transaction", { p_id: id }, txnPath(id));
}

export async function payTransaction(id: string): Promise<ActionState> {
  return runWorkflow("pay_finance_transaction", { p_id: id }, txnPath(id));
}

export async function declineTransaction(
  id: string,
  outcome: "returned" | "rejected",
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return runWorkflow("decline_finance_transaction", { p_id: id, p_outcome: outcome, p_reason: parsed.data.reason }, txnPath(id));
}

/** Turns a verified Administration contribution into a receipt (or a withdrawal for a reversal) and submits it. */
export async function postContribution(contributionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const bankAccountId = String(formData.get("bank_account_id") ?? "");
  if (!bankAccountId) return { fieldErrors: { bank_account_id: "Choose the account the money went into" } };
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("contributions_awaiting_posting")
    .select("id, member_id, kind, amount, paid_on, reference, payment_method, member_name")
    .eq("id", contributionId)
    .maybeSingle();
  if (!c) return { error: "That contribution is no longer waiting to be posted." };
  const { data: bank } = await supabase.from("bank_accounts").select("branch_id").eq("id", bankAccountId).maybeSingle();
  if (!bank) return { fieldErrors: { bank_account_id: "Choose the account the money went into" } };

  const isReversal = c.kind === "reversal";
  const { data, error } = await supabase
    .from("finance_transactions")
    .insert({
      direction: isReversal ? "payment" : "receipt",
      transaction_type: isReversal ? "savings_withdrawal" : "member_savings",
      bank_account_id: bankAccountId,
      branch_id: bank.branch_id,
      txn_date: c.paid_on,
      amount: Math.abs(Number(c.amount)),
      member_id: c.member_id,
      reference: c.reference,
      description: `${isReversal ? "Reversal of contribution" : c.kind === "top_up" ? "Top-up" : "Contribution"} from ${c.member_name}`,
      contribution_id: c.id,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error) };
  const submitted = await supabase.rpc("submit_finance_transaction", { p_id: data.id });
  if (submitted.error) return { error: friendlyDbError(submitted.error) };
  revalidatePath("/accounts", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Journals
// ---------------------------------------------------------------------------

export async function createJournal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const accounts = formData.getAll("line_account").map(String);
  const lines = accounts
    .map((account_code, i) => ({
      account_code,
      debit: String(formData.getAll("line_debit")[i] ?? ""),
      credit: String(formData.getAll("line_credit")[i] ?? ""),
      member_id: String(formData.getAll("line_member")[i] ?? ""),
      description: String(formData.getAll("line_description")[i] ?? ""),
    }))
    .filter((l) => l.account_code || l.debit || l.credit);
  const parsed = journalSchema.safeParse({ ...formObject(formData, ["branch_id", "entry_date", "description"]), lines });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { lines: journalLines, ...header } = parsed.data;
  const { data: entry, error } = await supabase.from("journal_entries").insert(header).select("id").single();
  if (error) return { error: friendlyDbError(error) };
  const { error: linesError } = await supabase.from("journal_lines").insert(
    journalLines.map((l, i) => ({ ...l, entry_id: entry.id, line_no: i + 1, branch_id: header.branch_id })),
  );
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    return { error: friendlyDbError(linesError) };
  }
  revalidatePath("/accounts/journals");
  redirect(`/accounts/journals/${entry.id}`);
}

export async function postJournal(id: string): Promise<ActionState> {
  return runWorkflow("post_journal_entry", { p_id: id }, `/accounts/journals/${id}`);
}

export async function deleteJournal(id: string): Promise<ActionState> {
  await requireModule(accountsModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("journal_entries").delete().eq("id", id).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only your own draft entries can be deleted." };
  revalidatePath("/accounts/journals");
  redirect("/accounts/journals");
}

export async function reverseJournal(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return runWorkflow("reverse_journal_entry", { p_id: id, p_reason: parsed.data.reason }, `/accounts/journals/${id}`);
}

// ---------------------------------------------------------------------------
// Bank statements and reconciliation
// ---------------------------------------------------------------------------

export async function importStatement(bankAccountId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const mapping = mappingSchema.safeParse(formObject(formData, ["date", "description", "reference", "debit", "credit", "balance"]));
  if (!mapping.success) return { fieldErrors: fieldErrors(mapping.error) };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Choose the statement file" } };
  if (file.size > MAX_STATEMENT_BYTES) return { fieldErrors: { file: "Statements can be at most 5 MB" } };
  const isXlsx = /\.xlsx$/i.test(file.name);
  if (!isXlsx && !/\.(csv|txt)$/i.test(file.name)) {
    return { fieldErrors: { file: "Upload the statement as an Excel (.xlsx) or CSV file. For an older .xls file, save it as .xlsx first." } };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let parsedStatement: ReturnType<typeof parseStatement>;
  if (isXlsx) {
    let sheet: string[][];
    try {
      sheet = readXlsxRows(bytes);
    } catch {
      return { fieldErrors: { file: "That Excel file couldn't be read. Open it in Excel, save it again as .xlsx, and retry." } };
    }
    parsedStatement = parseStatementRows(sheet, mapping.data);
  } else {
    parsedStatement = parseStatement(bytes.toString("utf8"), mapping.data);
  }
  const { lines, errors } = parsedStatement;
  if (errors.length) return { error: errors.slice(0, 5).join(" ") + (errors.length > 5 ? ` …and ${errors.length - 5} more.` : "") };
  if (!lines.length) return { error: "No statement lines with an amount were found in the file." };

  const supabase = await createClient();
  const { data: bank } = await supabase.from("bank_accounts").select("id, branch_id").eq("id", bankAccountId).maybeSingle();
  if (!bank) return { error: "Bank account not found." };

  const savedMapping = await supabase.rpc("save_bank_import_mapping", { p_bank_account_id: bank.id, p_mapping: mapping.data });
  if (savedMapping.error) return { error: friendlyDbError(savedMapping.error) };

  // Keep the original file as evidence of what was imported.
  const storagePath = `${bank.branch_id}/statements/${randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
  const upload = await supabase.storage.from("finance-evidence").upload(storagePath, bytes, {
    contentType: isXlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
    upsert: false,
  });
  const sha = createHash("sha256").update(bytes).digest("hex");
  const { data, error } = await supabase.rpc("import_bank_statement", {
    p_bank_account_id: bank.id,
    p_file_name: file.name.slice(0, 200),
    p_storage_path: upload.error ? null : storagePath,
    p_file_sha256: sha,
    p_lines: lines,
  });
  if (error) return { error: friendlyDbError(error) };
  const matched = await supabase.rpc("auto_match_bank_lines", { p_bank_account_id: bank.id });
  revalidatePath(bankPath(bankAccountId));
  const imported = data as { line_count: number; duplicate_count: number };
  return {
    ok: true,
    message:
      `Imported ${imported.line_count} line${imported.line_count === 1 ? "" : "s"}` +
      (imported.duplicate_count ? `, skipped ${imported.duplicate_count} already imported` : "") +
      (matched.data ? `, matched ${matched.data} automatically.` : "."),
  };
}

export async function autoMatch(bankAccountId: string): Promise<ActionState> {
  await requireModule(accountsModule);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("auto_match_bank_lines", { p_bank_account_id: bankAccountId });
  if (error) return { error: friendlyDbError(error) };
  // Lines still unmatched get fresh suggestions from everything posted so far.
  const refreshed = await supabase.rpc("refresh_statement_suggestions", { p_bank_account_id: bankAccountId });
  revalidatePath(bankPath(bankAccountId));
  const suggestions = refreshed.data ? ` Updated ${refreshed.data} suggestion${refreshed.data === 1 ? "" : "s"}.` : "";
  return {
    ok: true,
    message: (data ? `Matched ${data} line${data === 1 ? "" : "s"}.` : "No safe matches found; review the lines below.") + suggestions,
  };
}

export async function matchLines(bankAccountId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const statement = formData.getAll("statement").map(String);
  const ledger = formData.getAll("ledger").map(String);
  if (!statement.length || !ledger.length) return { error: "Tick at least one statement line and one ledger line to match." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("match_bank_lines", {
    p_statement_line_ids: statement,
    p_journal_line_ids: ledger,
    p_note: String(formData.get("note") ?? "") || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(bankPath(bankAccountId));
  return { ok: true, message: "Matched." };
}

export async function unmatch(bankAccountId: string, matchId: string): Promise<ActionState> {
  return runWorkflow("unmatch_bank_lines", { p_match_id: matchId }, bankPath(bankAccountId));
}

export async function excludeLine(bankAccountId: string, lineId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return runWorkflow("exclude_bank_statement_line", { p_line_id: lineId, p_reason: parsed.data.reason }, bankPath(bankAccountId));
}

export async function restoreLine(bankAccountId: string, lineId: string): Promise<ActionState> {
  return runWorkflow("exclude_bank_statement_line", { p_line_id: lineId, p_reason: null }, bankPath(bankAccountId));
}

export async function prepareReconciliation(bankAccountId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = reconciliationSchema.safeParse(formObject(formData, ["period_end", "statement_balance", "notes"]));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return runWorkflow(
    "prepare_bank_reconciliation",
    {
      p_bank_account_id: bankAccountId,
      p_period_end: parsed.data.period_end,
      p_statement_balance: parsed.data.statement_balance,
      p_notes: parsed.data.notes,
    },
    bankPath(bankAccountId),
  );
}

export async function completeReconciliation(bankAccountId: string, reconciliationId: string): Promise<ActionState> {
  return runWorkflow("complete_bank_reconciliation", { p_id: reconciliationId }, bankPath(bankAccountId));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function insertRow(table: string, values: Record<string, unknown>): Promise<ActionState> {
  await requireModule(accountsModule);
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert(values);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/accounts/settings");
  return { ok: true };
}

export async function addLedgerAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ledgerAccountSchema.safeParse(
    formObject(formData, ["code", "name", "parent_code", "account_type", "cash_flow_class", "description"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return insertRow("ledger_accounts", parsed.data);
}

export async function addBankAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = bankAccountSchema.safeParse(
    formObject(formData, ["branch_id", "name", "kind", "bank_name", "account_number", "ledger_account_code"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return insertRow("bank_accounts", parsed.data);
}

export async function addCategorisationRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const pattern = String(formData.get("pattern") ?? "").trim();
  const type = String(formData.get("transaction_type") ?? "");
  if (pattern.length < 3) return { fieldErrors: { pattern: "Enter at least three characters" } };
  if (!type) return { fieldErrors: { transaction_type: "Choose a transaction type" } };
  return insertRow("bank_categorisation_rules", { pattern: pattern.toUpperCase(), transaction_type: type });
}

/** Proposes a posting rule change. It applies only once someone else with configuration rights approves it. */
export async function proposePostingRuleChange(transactionType: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = postingRuleSchema.safeParse(
    formObject(formData, ["debit_account", "credit_account", "interest_account", "requires_member", "is_active", "reason"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const result = await insertRow("posting_rule_changes", { ...parsed.data, transaction_type: transactionType });
  return result.ok ? { ok: true, message: "Change proposed. It applies once someone else approves it." } : result;
}

export async function approvePostingRuleChange(changeId: string): Promise<ActionState> {
  return runWorkflow("decide_posting_rule_change", { p_id: changeId, p_approve: true, p_note: null }, "/accounts/settings");
}

export async function rejectPostingRuleChange(changeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 5) return { fieldErrors: { note: "Say why the change is rejected" } };
  return runWorkflow("decide_posting_rule_change", { p_id: changeId, p_approve: false, p_note: note }, "/accounts/settings");
}

// ---------------------------------------------------------------------------
// Suppliers and bills
// ---------------------------------------------------------------------------

const billPath = (id: string) => `/accounts/bills/${id}`;

export async function addSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = supplierSchema.safeParse(
    formObject(formData, ["name", "contact_person", "phone", "email", "address", "bank_name", "account_number", "tax_id"]),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  await requireModule(accountsModule);
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert(parsed.data);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/accounts/suppliers");
  return { ok: true };
}

export async function setSupplierActive(supplierId: string, active: boolean): Promise<ActionState> {
  await requireModule(accountsModule);
  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").update({ is_active: active }).eq("id", supplierId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You can't change suppliers." };
  revalidatePath("/accounts/suppliers");
  return { ok: true };
}

const BILL_FIELDS = [
  "supplier_id",
  "branch_id",
  "department_code",
  "bill_date",
  "due_date",
  "supplier_reference",
  "expense_account",
  "amount",
  "description",
] as const;

export async function saveBill(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const parsed = billSchema.safeParse(formObject(formData, BILL_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile) {
    const problem = evidenceFileError(file);
    if (problem) return { fieldErrors: { file: problem } };
  }

  const supabase = await createClient();
  let saved: { id: string; branch_id: string };
  if (id) {
    const { branch_id: _b, ...changes } = parsed.data;
    const { data, error } = await supabase.from("supplier_bills").update(changes).eq("id", id).select("id, branch_id");
    if (error) return { error: friendlyDbError(error) };
    if (!data?.length) return { error: "You can't edit this bill right now." };
    saved = data[0];
  } else {
    // bill_no is assigned by the database.
    const { data, error } = await supabase
      .from("supplier_bills")
      .insert({ ...parsed.data, bill_no: "pending" })
      .select("id, branch_id")
      .single();
    if (error) return { error: friendlyDbError(error) };
    saved = data;
  }
  if (hasFile) {
    const problem = await storeEvidence(supabase, { ...saved, bill: true }, file as File, "supporting");
    if (problem) return { error: `Saved, but the invoice didn't upload: ${problem}` };
  }
  revalidatePath("/accounts/bills");
  redirect(billPath(saved.id));
}

export async function uploadBillInvoice(billId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const file = formData.get("file");
  const problem = evidenceFileError(file);
  if (problem) return { fieldErrors: { file: problem } };
  const supabase = await createClient();
  const { data: bill } = await supabase.from("supplier_bills").select("id, branch_id").eq("id", billId).maybeSingle();
  if (!bill) return { error: "Bill not found." };
  const error = await storeEvidence(supabase, { ...bill, bill: true }, file as File, "supporting");
  if (error) return { error };
  revalidatePath(billPath(billId));
  return { ok: true };
}

export async function submitBill(id: string): Promise<ActionState> {
  return runWorkflow("submit_supplier_bill", { p_id: id }, billPath(id));
}

export async function approveBill(id: string): Promise<ActionState> {
  return runWorkflow("approve_supplier_bill", { p_id: id }, billPath(id));
}

export async function declineBill(id: string, outcome: "returned" | "rejected", _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  return runWorkflow("decline_supplier_bill", { p_id: id, p_outcome: outcome, p_reason: parsed.data.reason }, billPath(id));
}

// ---------------------------------------------------------------------------
// ROI accrual
// ---------------------------------------------------------------------------

/** Drafts the month's ROI accrual as a manual journal (Dr interest expense, Cr ROI payable per member) for the controller to post. */
export async function createRoiAccrual(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const members = formData
    .getAll("member_id")
    .map((member_id, i) => ({ member_id: String(member_id), amount: String(formData.getAll("amount")[i] ?? "").trim() }))
    .filter((m) => m.amount !== "" && Number(m.amount) !== 0);
  const parsed = accrualSchema.safeParse({ ...formObject(formData, ["branch_id", "entry_date", "description"]), members });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const { members: lines, ...header } = parsed.data;
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const supabase = await createClient();
  const { data: entry, error } = await supabase.from("journal_entries").insert(header).select("id").single();
  if (error) return { error: friendlyDbError(error) };
  const { error: linesError } = await supabase.from("journal_lines").insert([
    { entry_id: entry.id, line_no: 1, branch_id: header.branch_id, account_code: INTEREST_EXPENSE_ACCOUNT, debit: total, credit: 0, description: header.description },
    ...lines.map((l, i) => ({
      entry_id: entry.id,
      line_no: i + 2,
      branch_id: header.branch_id,
      account_code: ROI_PAYABLE_ACCOUNT,
      debit: 0,
      credit: l.amount,
      member_id: l.member_id,
      description: "ROI accrued",
    })),
  ]);
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    return { error: friendlyDbError(linesError) };
  }
  revalidatePath("/accounts/journals");
  redirect(`/accounts/journals/${entry.id}`);
}
