"use server";

import { randomUUID } from "node:crypto";
import type { ActionState } from "@/lib/action-state";
import { serviceClient } from "@/lib/supabase/admin";
import { fieldErrors } from "@/modules/administration/schemas";
import { CLIENT_DOCUMENTS, looksLike, SIGNUP_BUCKET, SIGNUP_MAX_BYTES, type ClientDocument } from "./constants";
import { signupSchema, uploadedSchema, uploadRequestSchema } from "./schemas";
import { clientIp, openLink, withinLimit } from "./signup";
import { hashSignupToken } from "./tokens";

/**
 * The public sign-up page's actions. Nobody is signed in, so each one checks the token again, counts the attempt
 * against the visitor's IP address and the link, and reaches the database only through service-role functions.
 */

const NOT_OPEN = "This link has expired or has already been used. Ask the Silverkuun staff member who sent it for a new one.";
const SLOW_DOWN = "Too many attempts from this connection. Wait an hour, then try again.";

export type UploadTicket = { document_type: ClientDocument; path: string; token: string };

/** One signed upload URL per file the client chose. Files go to a private bucket that only the server reads. */
export async function prepareSignupUploads(
  token: string,
  files: { document_type: string; name: string; type: string; size: number }[],
): Promise<{ tickets?: UploadTicket[]; error?: string; fieldErrors?: Record<string, string> }> {
  const parsed = uploadRequestSchema.safeParse(files);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = typeof issue?.path[0] === "number" ? issue.path[0] : -1;
    const key = index >= 0 ? `doc_${files[index]?.document_type}` : "form";
    return { fieldErrors: { [key]: issue?.message ?? "Check the files you chose" } };
  }
  if (new Set(parsed.data.map((f) => f.document_type)).size !== parsed.data.length) return { error: "Choose one file for each document." };
  if (!(await withinLimit(`upload:${await clientIp()}`, 20))) return { error: SLOW_DOWN };
  const link = await openLink(token);
  if (typeof link === "string") return { error: NOT_OPEN };

  const storage = serviceClient().storage.from(SIGNUP_BUCKET);
  const tickets: UploadTicket[] = [];
  for (const f of parsed.data) {
    const safeName = f.name.replace(/[^\w.-]+/g, "_").slice(-100) || "file";
    const path = `${link.linkId}/${randomUUID()}/${safeName}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return { error: "Your files couldn't be prepared for upload. Try again in a minute." };
    tickets.push({ document_type: f.document_type, path: data.path, token: data.token });
  }
  return { tickets };
}

/** Checks each uploaded file, moves it into the member's folder, and returns what to record. */
async function placeFiles(linkId: string, branchId: string, memberId: string, formData: FormData) {
  const storage = serviceClient().storage;
  const placed: { document_type: ClientDocument; file_name: string; storage_path: string; mime_type: string; size_bytes: number }[] = [];
  const problems: Record<string, string> = {};

  for (const key of Object.keys(CLIENT_DOCUMENTS) as ClientDocument[]) {
    const raw = formData.get(`doc_${key}`);
    if (typeof raw !== "string" || raw === "") continue;
    let ref;
    try {
      ref = uploadedSchema.parse(JSON.parse(raw));
    } catch {
      problems[`doc_${key}`] = "Choose the file again";
      continue;
    }
    // Only files uploaded through this link's own tickets.
    if (!ref.path.startsWith(`${linkId}/`) || ref.path.split("/").length !== 3 || ref.path.includes("..")) {
      problems[`doc_${key}`] = "Choose the file again";
      continue;
    }
    const { data: blob, error } = await storage.from(SIGNUP_BUCKET).download(ref.path);
    if (error || !blob) {
      problems[`doc_${key}`] = "This file didn't finish uploading. Choose it again";
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length === 0 || bytes.length > SIGNUP_MAX_BYTES || !looksLike(ref.type, bytes)) {
      problems[`doc_${key}`] = "Upload a PDF, JPEG or PNG of at most 10 MB";
      await storage.from(SIGNUP_BUCKET).remove([ref.path]);
      continue;
    }
    const safeName = ref.name.replace(/[^\w.-]+/g, "_").slice(-100) || "file";
    const storagePath = `${branchId}/${memberId}/${randomUUID()}-${safeName}`;
    const upload = await storage.from("member-documents").upload(storagePath, bytes, { contentType: ref.type, upsert: false });
    if (upload.error) {
      problems[`doc_${key}`] = "This file couldn't be saved. Try again";
      continue;
    }
    await storage.from(SIGNUP_BUCKET).remove([ref.path]);
    placed.push({ document_type: key, file_name: ref.name.slice(0, 200), storage_path: storagePath, mime_type: ref.type, size_bytes: bytes.length });
  }
  return { placed, problems };
}

/** The client sends their form. Their file goes to the staff member who made the link. */
export async function submitSignup(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ip = await clientIp();
  if (!(await withinLimit(`submit:${ip}`, 10))) return { error: SLOW_DOWN };

  const fields = Object.fromEntries(
    Object.keys(signupSchema.shape).map((k) => [k, (formData.get(k) as string | null) ?? ""]),
  );
  const parsed = signupSchema.safeParse(fields);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const hasBank = Boolean(v.bank_code || v.bank_name);
  if (hasBank && !v.bank_account_no) return { fieldErrors: { bank_account_no: "Enter the 10-digit account number" } };
  if (!hasBank && v.bank_account_no) return { fieldErrors: { bank_code: "Choose the bank" } };

  const link = await openLink(token);
  if (typeof link === "string") return { error: NOT_OPEN };
  if (!(await withinLimit(`link:${link.linkId}`, 10))) return { error: SLOW_DOWN };

  const memberId = randomUUID();
  const { placed, problems } = await placeFiles(link.linkId, link.branchId, memberId, formData);
  const storage = serviceClient().storage.from("member-documents");
  if (Object.keys(problems).length) {
    if (placed.length) await storage.remove(placed.map((p) => p.storage_path));
    return { fieldErrors: problems };
  }

  const { consent: _consent, ...member } = v;
  const { error } = await serviceClient().rpc("submit_member_signup", {
    p_token_hash: hashSignupToken(token),
    p_member_id: memberId,
    p_member: { ...member, bank_name: member.bank_code ? null : member.bank_name },
    p_documents: placed,
  });
  if (error) {
    if (placed.length) await storage.remove(placed.map((p) => p.storage_path));
    if (error.code === "23505" && /nin/i.test(error.message)) {
      return { fieldErrors: { nin: "This NIN is already registered with Silverkuun. Contact the staff member who sent you this link." } };
    }
    if (/expired|already been used|not valid/i.test(error.message)) return { error: NOT_OPEN };
    if (/date of birth/i.test(error.message)) return { fieldErrors: { date_of_birth: "Your date of birth must be in the past" } };
    if (error.code === "23514" || error.code === "22007" || error.code === "22008" || error.code === "23503") {
      return { error: "Some of the details weren't accepted. Check the date of birth, phone, email and bank, then try again." };
    }
    console.error("Client sign-up failed", error);
    return { error: "Something went wrong saving your form. Try again in a few minutes." };
  }
  return { ok: true };
}
