import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serviceRoleKey } from "@/lib/env";

/**
 * Supabase Auth administration: creating, resetting and switching off logins. It bypasses row level security,
 * so it is used for nothing else. Every caller first makes a change through the signed-in staff member's own
 * client (which the database checks), and only then touches the login.
 */
export function authAdmin() {
  const client = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client.auth.admin;
}

/** Long enough to mean "until someone switches it back on". */
const BANNED = "876000h";

/** Blocks or unblocks sign-in. The ERP already refuses inactive staff; this also stops their sessions refreshing. */
export async function setLoginBlocked(userId: string, blocked: boolean): Promise<string | undefined> {
  try {
    const { error } = await authAdmin().updateUserById(userId, { ban_duration: blocked ? BANNED : "none" });
    return error?.message;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
