type DbError = { code?: string; message: string };

// Errors our own database functions and triggers raise on purpose. Their messages are written for staff.
const USER_FACING_CODES = new Set(["23514", "42501", "P0002"]);

/** Turns a Supabase/Postgres error into a message that is safe and useful to show staff. */
export function friendlyDbError(error: DbError): string {
  if (error.code === "23505" && /nin/i.test(error.message)) return "A member with this NIN already exists.";
  if (error.code === "23505") return "That record already exists.";
  if (/row-level security/i.test(error.message)) return "You don't have permission to do that.";
  if (error.code && USER_FACING_CODES.has(error.code)) return capitalise(error.message);
  console.error("Unexpected database error", error);
  return "Something went wrong. Please try again, and tell the system administrator if it keeps happening.";
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".");
}
