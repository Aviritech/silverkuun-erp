type DbError = { code?: string; message: string };

// Errors our own database functions and triggers raise on purpose. Their messages are written for staff.
const USER_FACING_CODES = new Set(["23514", "42501", "P0002"]);

/** Turns a Supabase/Postgres error into a message that is safe and useful to show staff. */
export function friendlyDbError(error: DbError): string {
  if (error.code === "23505" && /nin/i.test(error.message)) return "A member with this NIN already exists.";
  if (error.code === "23505" && /reference/i.test(error.message)) return "That reference has already been used on this bank account.";
  if (error.code === "23505") return "That record already exists.";
  if (/row-level security/i.test(error.message)) return "You don't have permission to do that.";
  if (error.code && USER_FACING_CODES.has(error.code)) return capitalise(error.message);
  console.error("Unexpected database error", error);
  return "Something went wrong. Please try again, and tell the system administrator if it keeps happening.";
}

// Tables, views or functions the app expects but the database doesn't have: migrations haven't been applied.
const MISSING_OBJECT_CODES = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);

/**
 * Turns a failed read into a real Error for the error page. Supabase returns plain objects, which Next.js
 * shows as an unreadable "{code: …, message: …}", so pages throw this instead.
 */
export function dbFailure(error: DbError): Error {
  if (error.code && MISSING_OBJECT_CODES.has(error.code)) {
    return new Error(
      `The database is behind the app: ${error.message}. Apply the latest migrations with ` +
        `"npx supabase migration up" (local) or "npx supabase db push" (hosted project), then reload.`,
    );
  }
  if (error.code === "PGRST301" || error.code === "PGRST303") {
    return new Error("Your session has expired. Sign out and sign in again.");
  }
  return new Error(`Database error${error.code ? ` ${error.code}` : ""}: ${error.message}`);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".");
}
