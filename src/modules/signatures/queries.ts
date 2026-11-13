import "server-only";
import { createClient } from "@/lib/supabase/server";
import { SIGNATURE_BUCKET, type SignatureMethod, type SignerRole } from "./constants";

export type ESignature = {
  id: string;
  member_document_id: string | null;
  loan_document_id: string | null;
  loan_guarantor_id: string | null;
  signer_role: SignerRole;
  signer_name: string;
  signer_staff_id: string | null;
  method: SignatureMethod;
  typed_text: string | null;
  statement: string;
  storage_path: string;
  image_sha256: string;
  document_sha256: string | null;
  recorded_by: string;
  signed_at: string;
  /** A short-lived link to the signature image, or null when it can't be read. */
  url: string | null;
};

type Target = "member_document_id" | "loan_document_id" | "loan_guarantor_id";

/**
 * The e-signatures on the given documents or guarantors, oldest first, grouped by what they sign.
 * Read through the signed-in staff member's own access, so only what they may see comes back.
 */
export async function signaturesFor(column: Target, ids: string[]): Promise<Map<string, ESignature[]>> {
  const out = new Map<string, ESignature[]>();
  if (ids.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase.from("e_signatures").select("*").in(column, ids).order("signed_at");
  const rows = (data ?? []) as Omit<ESignature, "url">[];
  const signed = rows.length
    ? await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 300)
    : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  for (const r of rows) {
    const key = r[column] as string;
    out.set(key, [...(out.get(key) ?? []), { ...r, url: urls.get(r.storage_path) ?? null }]);
  }
  return out;
}

/** Everyone who recorded or signed as staff on these signatures, for name lookups. */
export function signatureStaffIds(groups: Map<string, ESignature[]>): string[] {
  return [...groups.values()].flat().flatMap((s) => [s.recorded_by, s.signer_staff_id]).filter((id): id is string => Boolean(id));
}
