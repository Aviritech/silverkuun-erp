import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

// The pieces of a Supabase database that our migrations rely on: the auth schema,
// auth.uid() read from the request JWT, and the anon/authenticated roles.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

export async function createTestDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** Run `fn` as a signed-in staff member, the way PostgREST does for a request. Always rolls back. */
export async function asUser<T>(db: PGlite, userId: string, fn: (db: PGlite) => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated; set local request.jwt.claim.sub = '${userId}';`);
    return await fn(db);
  } finally {
    await db.exec("rollback");
  }
}
