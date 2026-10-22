import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

/** Public Supabase settings. Throws on first use if they are missing, so misconfiguration fails loudly. */
export function publicEnv() {
  return schema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * The service role key, needed only to create, reset or switch off logins in Supabase Auth.
 * Read on first use rather than at start-up, so the rest of the app works without it.
 */
export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set, so logins can't be created or changed. Add it from Supabase " +
        "(Project Settings → API Keys, the service_role / secret key) to .env.local or the Vercel project settings.",
    );
  }
  return key;
}
