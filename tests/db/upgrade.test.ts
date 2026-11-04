import { describe, expect, it } from "vitest";
import { applyMigrations, createTestDatabase } from "./harness";

// Production already has data when a migration runs, so each migration has to work on a database with existing rows,
// not only on an empty one.
describe("upgrading a database that already has data", () => {
  it("backfills interest rates on existing plans despite the plan guard", async () => {
    const db = await createTestDatabase({ before: "20261030000003" });
    // Existing rows, inserted without triggers or foreign-key checks so the test needs no full member file.
    await db.exec(`
      set session_replication_role = replica;
      insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date, created_by)
      values (gen_random_uuid(), gen_random_uuid(), 'gold', 50000, 'monthly', '2026-01-01', '2027-01-01', gen_random_uuid());
      set session_replication_role = origin;
    `);

    await applyMigrations(db, { from: "20261030000003" });

    const res = await db.query<{ interest_rate: string }>("select interest_rate from member_plans");
    expect(res.rows.map((r) => Number(r.interest_rate))).toEqual([12]);
  });
});
