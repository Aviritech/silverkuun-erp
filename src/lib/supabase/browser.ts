"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * Supabase client for the browser. It reads the same session cookie the server uses, so it acts as the signed-in
 * staff member. The app only uses it to listen for live updates; data is still read on the server.
 */
export function browserClient(): SupabaseClient {
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}
