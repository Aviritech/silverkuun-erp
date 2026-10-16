import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const SYSADMIN = "00000000-0000-0000-0000-00000000000a";
const OFFICER_LAGOS = "00000000-0000-0000-0000-00000000000b";
const AUDITOR = "00000000-0000-0000-0000-00000000000c";
const MANAGER_ABUJA = "00000000-0000-0000-0000-00000000000d";

let db: PGlite;
let lagos: string;
let abuja: string;

async function addStaff(id: string, email: string, department: string, role: string, branchId: string | null) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  await db.query(
    "insert into public.staff (id, full_name, email, department_code, home_branch_id) values ($1, $2, $2, $3, $4)",
    [id, email, department, branchId],
  );
  await db.query("insert into public.staff_roles (staff_id, role_code, branch_id) values ($1, $2, $3)", [
    id,
    role,
    branchId,
  ]);
}

beforeAll(async () => {
  db = await createTestDatabase();
  const south = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  const north = await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id");
  lagos = (
    await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [
      south.rows[0].id,
    ])
  ).rows[0].id;
  abuja = (
    await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [
      north.rows[0].id,
    ])
  ).rows[0].id;

  await addStaff(SYSADMIN, "sysadmin@kuun.test", "system", "system_admin", null);
  await addStaff(OFFICER_LAGOS, "officer@kuun.test", "administration", "admin_officer", lagos);
  await addStaff(AUDITOR, "auditor@kuun.test", "internal_audit", "internal_auditor", null);
  await addStaff(MANAGER_ABUJA, "manager@kuun.test", "branch_operations", "branch_manager", abuja);
});

describe("permissions", () => {
  it("returns only the signed-in staff member's permissions", async () => {
    const perms = await asUser(db, OFFICER_LAGOS, (tx) =>
      tx.query<{ permission_code: string; branch_id: string }>("select * from my_permissions()"),
    );
    expect(perms.rows).toEqual([{ permission_code: "module.administration", branch_id: lagos, region_id: null }]);
  });

  it("scopes branch permissions to the assigned branch", async () => {
    const result = await asUser(db, MANAGER_ABUJA, (tx) =>
      tx.query<{ abuja: boolean; lagos: boolean }>(
        "select app.has_branch_permission('module.administration', $1) as abuja, app.has_branch_permission('module.administration', $2) as lagos",
        [abuja, lagos],
      ),
    );
    expect(result.rows[0]).toEqual({ abuja: true, lagos: false });
  });

  it("treats organisation-wide roles as covering every branch", async () => {
    const result = await asUser(db, AUDITOR, (tx) =>
      tx.query<{ ok: boolean }>("select app.has_branch_permission('audit.trail.read', $1) as ok", [abuja]),
    );
    expect(result.rows[0].ok).toBe(true);
  });

  it("gives deactivated staff no permissions", async () => {
    await db.query("update staff set is_active = false where id = $1", [MANAGER_ABUJA]);
    const perms = await asUser(db, MANAGER_ABUJA, (tx) => tx.query("select * from my_permissions()"));
    await db.query("update staff set is_active = true where id = $1", [MANAGER_ABUJA]);
    expect(perms.rows).toHaveLength(0);
  });
});

describe("staff and roles", () => {
  it("lets staff see only their own profile without staff.read", async () => {
    const rows = await asUser(db, OFFICER_LAGOS, (tx) => tx.query<{ id: string }>("select id from staff"));
    expect(rows.rows.map((r) => r.id)).toEqual([OFFICER_LAGOS]);
  });

  it("lets auditors read the whole staff directory", async () => {
    const rows = await asUser(db, AUDITOR, (tx) => tx.query("select id from staff"));
    expect(rows.rows).toHaveLength(4);
  });

  it("stops staff from granting themselves roles", async () => {
    await expect(
      asUser(db, OFFICER_LAGOS, (tx) =>
        tx.query("insert into staff_roles (staff_id, role_code, granted_by) values ($1, 'system_admin', $1)", [OFFICER_LAGOS]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("stops even a system administrator from granting their own roles", async () => {
    await expect(
      asUser(db, SYSADMIN, (tx) =>
        tx.query("insert into staff_roles (staff_id, role_code, granted_by) values ($1, 'internal_auditor', $1)", [SYSADMIN]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets a system administrator grant roles to someone else", async () => {
    const rows = await asUser(db, SYSADMIN, (tx) =>
      tx.query(
        "insert into staff_roles (staff_id, role_code, branch_id, granted_by) values ($1, 'admin_officer', $2, $3) returning id",
        [MANAGER_ABUJA, abuja, SYSADMIN],
      ),
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("does not let auditors change branches", async () => {
    const result = await asUser(db, AUDITOR, (tx) =>
      tx.query("update branches set name = 'Changed' where id = $1", [lagos]),
    );
    expect(result.affectedRows).toBe(0);
  });
});

describe("audit trail", () => {
  it("records who changed what, and which fields", async () => {
    // Commit a real change attributed to the system admin (asUser always rolls back).
    await db.exec(`begin; set local request.jwt.claim.sub = '${SYSADMIN}';`);
    await db.query("update branches set name = 'Lagos Island' where id = $1", [lagos]);
    await db.exec("commit");

    const entry = await db.query<{ actor_id: string; action: string; changed_fields: string[]; old_name: string; new_name: string }>(
      `select actor_id, action, changed_fields, old_data->>'name' as old_name, new_data->>'name' as new_name
       from audit_log where table_name = 'public.branches' and record_id = $1 and action = 'UPDATE'`,
      [lagos],
    );
    expect(entry.rows).toEqual([
      { actor_id: SYSADMIN, action: "UPDATE", changed_fields: ["name"], old_name: "Lagos", new_name: "Lagos Island" },
    ]);
  });

  it("tags changes with their branch so audit access can be scoped", async () => {
    const entry = await db.query<{ branch_id: string }>(
      "select branch_id from audit_log where table_name = 'public.staff_roles' and new_data->>'staff_id' = $1",
      [OFFICER_LAGOS],
    );
    expect(entry.rows[0].branch_id).toBe(lagos);
  });

  it("is readable by auditors but not by other staff", async () => {
    const auditor = await asUser(db, AUDITOR, (tx) => tx.query("select id from audit_log"));
    const officer = await asUser(db, OFFICER_LAGOS, (tx) => tx.query("select id from audit_log"));
    expect(auditor.rows.length).toBeGreaterThan(0);
    expect(officer.rows).toHaveLength(0);
  });

  it("cannot be edited or deleted by anyone, including the database owner", async () => {
    await expect(db.query("update audit_log set action = 'INSERT'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from audit_log")).rejects.toThrow(/append-only/);
    await expect(db.query("truncate audit_log")).rejects.toThrow(/append-only/);
  });

  it("cannot be written to directly by signed-in staff", async () => {
    await expect(
      asUser(db, AUDITOR, (tx) => tx.query("insert into audit_log (table_name, action) values ('x', 'INSERT')")),
    ).rejects.toThrow(/permission denied/);
  });
});
