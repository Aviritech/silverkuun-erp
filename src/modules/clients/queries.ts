import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dbFailure } from "@/lib/db-errors";
import type { MemberStatus } from "@/modules/administration/constants";
import type { LinkState } from "./constants";

export type MyClient = {
  member_id: string;
  membership_no: string | null;
  full_name: string;
  phone: string;
  status: MemberStatus;
  source: "staff" | "self_signup";
  branch_name: string;
  joined_on: string;
  open_plans: number;
  total_contributed: string;
  total_verified: string;
  paid_this_month: string;
  last_paid_on: string | null;
};

/** The members the signed-in staff member brought in, with what each has paid. */
export async function listMyClients(): Promise<MyClient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_clients");
  if (error) throw dbFailure(error);
  return (data ?? []) as MyClient[];
}

export type SignupLink = {
  id: string;
  branch_id: string;
  client_name: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  member_id: string | null;
};

export function linkState(l: SignupLink, now = Date.now()): LinkState {
  if (l.used_at) return "used";
  if (l.revoked_at) return "revoked";
  if (new Date(l.expires_at).getTime() <= now) return "expired";
  return "open";
}

/** The signed-in staff member's own sign-up links, newest first. */
export async function listMyLinks(limit = 50): Promise<SignupLink[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_signup_links")
    .select("id, branch_id, client_name, created_at, expires_at, revoked_at, used_at, member_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw dbFailure(error);
  return (data ?? []) as SignupLink[];
}

export type FixLink = { id: string; created_by: string; created_at: string; expires_at: string };

/** The open link (if any) that lets the client correct their returned file. */
export async function openFixLinkFor(memberId: string): Promise<FixLink | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_fix_links")
    .select("id, created_by, created_at, expires_at")
    .eq("member_id", memberId)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbFailure(error);
  return data as FixLink | null;
}
