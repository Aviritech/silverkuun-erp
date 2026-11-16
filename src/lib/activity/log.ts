import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { logFailedSignInAsServer } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { describePath } from "./describe";

export type ActivityEvent = "sign_in" | "sign_out" | "page_view" | "download" | "password_changed";

async function requestInfo() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent")?.slice(0, 400) ?? null,
    // Vercel puts the visitor's address first.
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || h.get("x-real-ip") || null,
  };
}

/**
 * Records what the signed-in staff member did, for the Usage page. The database stamps who did it, so nobody can
 * log activity in someone else's name. Never throws: a missing log entry must not stop anyone working.
 */
export async function logActivity(
  event: ActivityEvent,
  opts: { path?: string; label?: string; module?: string | null; detail?: Record<string, unknown>; supabase?: SupabaseClient } = {},
): Promise<void> {
  try {
    const supabase = opts.supabase ?? (await createClient());
    const page = opts.path ? describePath(opts.path) : null;
    const { userAgent, ip } = await requestInfo();
    const { error } = await supabase.rpc("log_activity", {
      p_event: event,
      p_path: opts.path?.slice(0, 300) ?? null,
      p_module: opts.module !== undefined ? opts.module : (page?.module ?? null),
      p_label: (opts.label ?? page?.label ?? null)?.slice(0, 200) ?? null,
      p_detail: opts.detail ?? {},
      p_user_agent: userAgent,
      p_ip: ip,
    });
    if (error) console.error("Usage log failed", { event, code: error.code, message: error.message });
  } catch (error) {
    console.error("Usage log failed", { event, error });
  }
}

/** Records a failed sign-in. Never throws. */
export async function logFailedSignIn(email: string): Promise<void> {
  try {
    const { userAgent, ip } = await requestInfo();
    await logFailedSignInAsServer(email, userAgent, ip);
  } catch (error) {
    console.error("Usage log failed", { event: "sign_in_failed", error });
  }
}
