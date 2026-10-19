import { describe, expect, it, vi } from "vitest";
import { dbFailure, friendlyDbError } from "./db-errors";

describe("friendlyDbError", () => {
  it("passes through messages our database raises for staff", () => {
    expect(friendlyDbError({ code: "23514", message: "missing required documents: utility_bill" })).toBe(
      "Missing required documents: utility_bill.",
    );
  });

  it("explains a duplicate NIN", () => {
    expect(friendlyDbError({ code: "23505", message: 'duplicate key value violates unique constraint "members_nin_key"' })).toBe(
      "A member with this NIN already exists.",
    );
  });

  it("hides unexpected database detail", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(friendlyDbError({ code: "42P01", message: 'relation "secret_table" does not exist' })).not.toMatch(/secret_table/);
  });

  it("turns row level security refusals into a permission message", () => {
    expect(friendlyDbError({ code: "42501", message: 'new row violates row-level security policy for table "members"' })).toBe(
      "You don't have permission to do that.",
    );
  });
});

describe("dbFailure", () => {
  it("returns a real Error, so the error page shows a message instead of a raw object", () => {
    const e = dbFailure({ code: "23514", message: "boom" });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("Database error 23514: boom");
  });

  it("tells the developer to apply migrations when a table is missing", () => {
    const e = dbFailure({ code: "PGRST205", message: "Could not find the table 'public.members' in the schema cache" });
    expect(e.message).toMatch(/public\.members/);
    expect(e.message).toMatch(/supabase migration up/);
  });
});
