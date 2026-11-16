"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getCurrentStaff } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import { MAX_SIGNATURE_BYTES, SIGNATURE_BUCKET } from "./constants";
import { eSignatureSchema } from "./schemas";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

type Target =
  | { kind: "member_document"; id: string; path: string }
  | { kind: "loan_document"; id: string; path: string }
  | { kind: "loan_guarantor"; id: string; path: string };

/**
 * Records an e-signature: checks the image, fingerprints the document as it is now, stores the image in the private
 * "e-signatures" bucket and adds the signature row. The database decides who may sign what, and writes the statement
 * of what was signed itself.
 */
async function recordSignature(target: Target, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = eSignatureSchema.safeParse({
    signer_role: formData.get("signer_role") ?? "",
    signer_name: formData.get("signer_name") ?? "",
    method: formData.get("method") ?? "",
    typed_text: formData.get("typed_text") ?? "",
    signature: formData.get("signature") ?? "",
    consent: formData.get("consent") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const image = Buffer.from(v.signature.slice("data:image/png;base64,".length), "base64");
  if (image.length < PNG_MAGIC.length || !image.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { fieldErrors: { signature: "The signature didn't come through; clear it and sign again" } };
  }
  if (image.length > MAX_SIGNATURE_BYTES) return { fieldErrors: { signature: "The signature is too large; clear it and sign again" } };

  const supabase = await createClient();

  // Where the signature goes, and a fingerprint of the document file as it was signed.
  let branchId: string;
  let folder: "member" | "loan";
  let documentHash: string | null = null;
  if (target.kind === "loan_guarantor") {
    const { data } = await supabase.from("loan_guarantors").select("branch_id").eq("id", target.id).maybeSingle();
    if (!data) return { error: "Guarantor not found." };
    branchId = data.branch_id;
    folder = "loan";
  } else {
    const table = target.kind === "member_document" ? "member_documents" : "loan_documents";
    const bucket = target.kind === "member_document" ? "member-documents" : "loan-documents";
    const { data } = await supabase.from(table).select("branch_id, storage_path").eq("id", target.id).maybeSingle();
    if (!data) return { error: "Document not found." };
    branchId = data.branch_id;
    folder = target.kind === "member_document" ? "member" : "loan";
    const file = await supabase.storage.from(bucket).download(data.storage_path);
    if (file.error || !file.data) return { error: "The document's file couldn't be read, so it can't be signed. Try again, or upload it again." };
    documentHash = sha256(new Uint8Array(await file.data.arrayBuffer()));
  }

  const storagePath = `${branchId}/${folder}/${randomUUID()}.png`;
  const upload = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .upload(storagePath, image, { contentType: "image/png", upsert: false });
  if (upload.error) return { error: friendlyDbError({ message: upload.error.message }) };

  const { error } = await supabase.from("e_signatures").insert({
    [`${target.kind}_id`]: target.id,
    branch_id: branchId,
    signer_role: v.signer_role,
    // Replaced by the database with the staff member's or guarantor's own name where it applies.
    signer_name: v.signer_role === "staff" ? "staff" : v.signer_name,
    method: v.method,
    typed_text: v.method === "typed" ? v.typed_text : null,
    statement: "-",
    storage_path: storagePath,
    image_sha256: sha256(image),
    document_sha256: documentHash,
    consent_given: true,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(target.path);
  return { ok: true };
}

export async function signMemberDocument(memberId: string, documentId: string, _prev: ActionState, formData: FormData) {
  return recordSignature({ kind: "member_document", id: documentId, path: `/administration/members/${memberId}` }, formData);
}

export async function signLoanDocument(loanId: string, documentId: string, _prev: ActionState, formData: FormData) {
  return recordSignature({ kind: "loan_document", id: documentId, path: `/credit/loans/${loanId}` }, formData);
}

export async function signGuarantee(loanId: string, guarantorId: string, _prev: ActionState, formData: FormData) {
  return recordSignature({ kind: "loan_guarantor", id: guarantorId, path: `/credit/loans/${loanId}` }, formData);
}
