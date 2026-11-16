"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { ActionState } from "@/lib/action-state";
import { getCurrentStaff } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, marketerReviewSchema, returnSchema } from "@/modules/administration/schemas";
import { fixLinkSchema, linkSchema } from "./schemas";
import { hashSignupToken, newSignupToken } from "./tokens";

/** Where the app is served: the configured site address, or the address this request came in on. */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Any staff member creates a one-time sign-up link. The link is shown once; only its hash is kept. */
export async function createSignupLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = linkSchema.safeParse({
    branch_id: formData.get("branch_id") ?? "",
    client_name: formData.get("client_name") ?? "",
    days: formData.get("days") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const token = newSignupToken();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_member_signup_link", {
    p_token_hash: hashSignupToken(token),
    p_branch_id: parsed.data.branch_id,
    p_client_name: parsed.data.client_name,
    p_days: parsed.data.days,
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/clients/links");
  return { ok: true, secret: `${await siteOrigin()}/join/${token}` };
}

export async function revokeSignupLink(linkId: string): Promise<ActionState> {
  await getCurrentStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_member_signup_link", { p_id: linkId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/clients/links");
  return { ok: true };
}

/**
 * A client's own sign-up came back: the staff member who brought them in, or the branch's officer, sends the client a
 * one-time link to their form, with their answers and the reason. Shown once; only its hash is kept.
 */
export async function createFixLink(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = fixLinkSchema.safeParse({ days: formData.get("days") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const token = newSignupToken();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_member_fix_link", {
    p_token_hash: hashSignupToken(token),
    p_member_id: memberId,
    p_days: parsed.data.days,
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(`/clients/${memberId}`);
  revalidatePath(`/administration/members/${memberId}`);
  return { ok: true, secret: `${await siteOrigin()}/join/fix/${token}` };
}

/** Switches off a fix link that was sent to the wrong person or is no longer needed. */
export async function revokeFixLink(linkId: string, memberId: string): Promise<ActionState> {
  await getCurrentStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_member_fix_link", { p_id: linkId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/clients/${memberId}`);
  revalidatePath(`/administration/members/${memberId}`);
  return { ok: true };
}

/** The staff member who brought the client in confirms them; the file goes to the Operations Officer. */
export async function confirmClient(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = marketerReviewSchema.safeParse({ note: formData.get("note") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("marketer_review_member", { p_member_id: memberId, p_note: parsed.data.note });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/clients", "layout");
  return { ok: true };
}

/** Not their client, or details wrong: back to the officer with the reason. */
export async function returnClient(memberId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = returnSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_member", { p_member_id: memberId, p_reason: parsed.data.reason });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/clients", "layout");
  return { ok: true };
}
