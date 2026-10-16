import { describe, expect, it, vi } from "vitest";
import { friendlyDbError } from "./db-errors";

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
