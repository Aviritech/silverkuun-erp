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

  it("adds liquidations and payment returns to a database that already has plans and payments", async () => {
    const db = await createTestDatabase({ before: "20261104000003" });
    await db.exec(`
      set session_replication_role = replica;
      insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date, created_by, interest_rate)
      values (gen_random_uuid(), gen_random_uuid(), 'gold', 50000, 'monthly', '2025-01-01', '2026-01-01', gen_random_uuid(), 12);
      insert into finance_transactions (txn_no, branch_id, direction, transaction_type, status, txn_date, amount, bank_account_id, description, created_by)
      values ('PAY-000001', gen_random_uuid(), 'payment', 'admin_expense', 'approved', '2026-11-01', 100, gen_random_uuid(), 'Existing', gen_random_uuid());
      set session_replication_role = origin;
    `);

    await applyMigrations(db, { from: "20261104000003" });

    const res = await db.query<{ liquidation_id: string | null }>("select liquidation_id from finance_transactions");
    expect(res.rows).toEqual([{ liquidation_id: null }]);
    const perms = await db.query<{ role_code: string }>(
      "select role_code from role_permissions where permission_code like 'liquidations.%' order by role_code",
    );
    expect(perms.rows.map((r) => r.role_code)).toEqual(["admin_officer", "branch_manager", "head_of_administration"]);
  });
  it("adds the landmark, restructure approval and late penalty to a database that already has loans and repayments", async () => {
    const db = await createTestDatabase({ before: "20261113000001" });
    await db.exec(`
      set session_replication_role = replica;
      insert into loan_repayments (loan_id, branch_id, finance_transaction_id, txn_no, paid_on, amount, principal, interest, schedule_version)
      values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'RCP-000001', '2026-11-01', 33000, 30000, 3000, 1);
      insert into finance_transactions (txn_no, branch_id, direction, transaction_type, status, txn_date, amount, interest_amount, bank_account_id, description, created_by)
      values ('RCP-000001', gen_random_uuid(), 'receipt', 'loan_repayment', 'posted', '2026-11-01', 33000, 3000, gen_random_uuid(), 'Existing', gen_random_uuid());
      set session_replication_role = origin;
    `);

    await applyMigrations(db, { from: "20261113000001" });

    expect((await db.query("select penalty from loan_repayments")).rows).toEqual([{ penalty: "0.00" }]);
    expect((await db.query("select penalty_amount from finance_transactions")).rows).toEqual([{ penalty_amount: "0.00" }]);
    const rates = await db.query<{ late_penalty_rate: string }>("select distinct late_penalty_rate from loan_products");
    expect(rates.rows).toEqual([{ late_penalty_rate: "0.1000" }]);
  });
});
