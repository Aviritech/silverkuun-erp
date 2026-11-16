import "server-only";
import { headers } from "next/headers";
import { serviceClient } from "@/lib/supabase/admin";
import { hashSignupToken, isSignupToken } from "./tokens";

/** Shared by the public sign-up page and its actions. Not server actions: nothing here can be called from a browser. */

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Counts an attempt against `key` and says whether it is within `limit` an hour. Fails closed. */
export async function withinLimit(key: string, limit: number): Promise<boolean> {
  const { data, error } = await serviceClient().rpc("signup_rate_check", { p_key: key, p_limit: limit, p_window: "1 hour" });
  if (error) {
    console.error("Sign-up rate check failed", error);
    return false;
  }
  return data === true;
}

export type OpenLink = { linkId: string; branchId: string; branchName: string; staffName: string; clientName: string | null; expiresAt: string };

/** The link behind a token, when it is still open. Used by the page and by every action. */
export async function openLink(token: string): Promise<OpenLink | "closed" | "invalid"> {
  if (!isSignupToken(token)) return "invalid";
  const { data, error } = await serviceClient().rpc("signup_link_status", { p_token_hash: hashSignupToken(token) });
  if (error) throw new Error(`Sign-up link lookup failed: ${error.message}`);
  const row = (data ?? [])[0] as
    | { link_id: string; branch_id: string; branch_name: string; staff_name: string; client_name: string | null; expires_at: string; state: string }
    | undefined;
  if (!row) return "invalid";
  if (row.state !== "open") return "closed";
  return {
    linkId: row.link_id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    staffName: row.staff_name,
    clientName: row.client_name,
    expiresAt: row.expires_at,
  };
}

/** Counts a page view, so the page can't be used to test tokens at speed. */
export async function pageViewAllowed(): Promise<boolean> {
  return withinLimit(`view:${await clientIp()}`, 60);
}

