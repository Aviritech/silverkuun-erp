import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const SYSADMIN = "00000000-0000-0000-0000-0000000000a1";
const OFFICER_LAGOS = "00000000-0000-0000-0000-0000000000a2";
const MANAGER_ABUJA = "00000000-0000-0000-0000-0000000000a3";
const AUDITOR_SOUTH = "00000000-0000-0000-0000-0000000000a4";
const AUDITOR_ALL = "00000000-0000-0000-0000-0000000000a5";

let db: PGlite;
let lagos: string;
let abuja: string;
let south: string;

// Usage is grouped by Lagos calendar day (UTC+1).
const TODAY = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

async function addStaff(id: string, department: string, role: string, homeBranch: string | null, scope: { branch?: string; region?: string } = {}) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
  await db.query("insert into staff (id, full_name, email, department_code, home_branch_id) values ($1, $2, $3, $4, $5)", [
    id,
    `Person ${id.slice(-2)}`,
    `${id}@kuun.test`,
    department,
    homeBranch,
  ]);
  await db.query("insert into staff_roles (staff_id, role_code, branch_id, region_id) values ($1, $2, $3, $4)", [
    id,
    role,
    scope.branch ?? null,
    scope.region ?? null,
  ]);
}

/** Runs as the staff member and commits, the way a request from the app does. */
async function commitAs(userId: string, sql: string, params: unknown[] = []) {
  await db.exec(`begin; set local role authenticated; set local request.jwt.claim.sub = '${userId}';`);
  try {
    await db.query(sql, params);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  south = (await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id")).rows[0].id;
  const north = (await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id")).rows[0].id;
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [south])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [north])).rows[0].id;

  await addStaff(SYSADMIN, "system", "system_admin", null);
  await addStaff(OFFICER_LAGOS, "administration", "admin_officer", lagos, { branch: lagos });
  await addStaff(MANAGER_ABUJA, "branch_operations", "branch_manager", abuja, { branch: abuja });
  await addStaff(AUDITOR_SOUTH, "internal_audit", "internal_auditor", lagos, { region: south });
  await addStaff(AUDITOR_ALL, "internal_audit", "internal_auditor", null);

  await commitAs(OFFICER_LAGOS, "select log_activity('sign_in', '/login', null, 'Sign in', '{}', 'Test browser', '10.0.0.1')");
  await commitAs(OFFICER_LAGOS, "select log_activity('page_view', '/administration/members', 'administration', 'Members')");
  await commitAs(OFFICER_LAGOS, "select log_activity('page_view', '/administration/members', 'administration', 'Members')");
  await commitAs(MANAGER_ABUJA, "select log_activity('sign_in', '/login', null, 'Sign in')");
  await commitAs(MANAGER_ABUJA, "select log_activity('page_view', '/administration', 'administration', 'Overview')");
  await commitAs(SYSADMIN, "select log_activity('page_view', '/system/staff', 'system', 'Staff access')");
  // A record change, which audit_log already captures.
  await commitAs(SYSADMIN, "update branches set name = 'Lagos Island' where id = $1", [lagos]);
  // Failed sign-ins come from the server, as the service role.
  await db.exec("set role service_role");
  await db.query("select log_failed_sign_in('Wrong@Kuun.test', 'Test browser', '10.0.0.9')");
  await db.query("select log_failed_sign_in($1)", [`${OFFICER_LAGOS}@kuun.test`]);
  await db.exec("reset role");
});

describe("activity log", () => {
  it("records activity in the signed-in staff member's name, with their home branch", async () => {
    const rows = await db.query<{ staff_id: string; branch_id: string; event: string }>(
      "select staff_id, branch_id, event from activity_log where event = 'sign_in' order by id",
    );
    expect(rows.rows).toEqual([
      { staff_id: OFFICER_LAGOS, branch_id: lagos, event: "sign_in" },
      { staff_id: MANAGER_ABUJA, branch_id: abuja, event: "sign_in" },
    ]);
  });

  it("can't be written, changed or deleted directly by staff", async () => {
    for (const sql of [
      "insert into activity_log (event) values ('sign_in')",
      "update activity_log set label = 'x'",
      "delete from activity_log",
    ]) {
      await expect(asUser(db, SYSADMIN, (tx) => tx.query(sql))).rejects.toThrow();
    }
    await expect(db.query("update activity_log set label = 'x'")).rejects.toThrow(/can't be changed/);
  });

  it("refuses events staff may not log themselves, and failed sign-ins from staff", async () => {
    await expect(asUser(db, OFFICER_LAGOS, (tx) => tx.query("select log_activity('sign_in_failed')"))).rejects.toThrow(/Unknown activity/);
    await expect(asUser(db, OFFICER_LAGOS, (tx) => tx.query("select log_failed_sign_in('x@kuun.test')"))).rejects.toThrow();
  });

  it("links a failed sign-in to the staff member when the email matches one", async () => {
    const rows = await db.query<{ staff_id: string | null; detail: { email: string } }>(
      "select staff_id, detail from activity_log where event = 'sign_in_failed' order by id",
    );
    expect(rows.rows).toEqual([
      { staff_id: null, detail: { email: "wrong@kuun.test" } },
      { staff_id: OFFICER_LAGOS, detail: { email: `${OFFICER_LAGOS}@kuun.test` } },
    ]);
  });
});

describe("reading usage", () => {
  type Event = { kind: string; staff_id: string | null; staff_name: string; label: string; detail: Record<string, unknown> };
  const events = (user: string, args = "") =>
    asUser(db, user, async (tx) => (await tx.query<Event>(`select * from usage_events('${TODAY}', '${TODAY}'${args})`)).rows);

  it("shows System Administrators every event, including record changes without their values", async () => {
    const rows = await events(SYSADMIN);
    expect(rows.filter((r) => r.kind === "page_view")).toHaveLength(4);
    const change = rows.find((r) => r.kind === "change")!;
    expect(change).toMatchObject({ staff_id: SYSADMIN, label: "Changed branches" });
    expect(change.detail).toEqual({ table: "branches", action: "UPDATE", record_id: lagos, fields: ["name"] });
    expect(rows.find((r) => r.kind === "sign_in_failed" && r.staff_id === null)?.staff_name).toBe("wrong@kuun.test");
  });

  it("filters by person, role, department, branch and kind", async () => {
    expect((await events(SYSADMIN, `, p_staff => '${MANAGER_ABUJA}'`)).map((r) => r.label).sort()).toEqual(["Overview", "Sign in"]);
    expect((await events(SYSADMIN, ", p_role => 'admin_officer', p_kind => 'page_view'"))).toHaveLength(2);
    expect((await events(SYSADMIN, ", p_department => 'system'")).map((r) => r.kind).sort()).toEqual(["change", "page_view"]);
    expect((await events(SYSADMIN, `, p_branch => '${abuja}'`))).toHaveLength(2);
  });

  it("limits a regional auditor to people based in their region, and hides it from everyone else", async () => {
    const rows = await events(AUDITOR_SOUTH);
    expect(new Set(rows.map((r) => r.staff_id))).toEqual(new Set([OFFICER_LAGOS]));
    expect(await events(AUDITOR_ALL)).toHaveLength((await events(SYSADMIN)).length);
    expect(await events(OFFICER_LAGOS)).toEqual([]);
    expect(await asUser(db, OFFICER_LAGOS, async (tx) => (await tx.query("select * from activity_log")).rows)).toEqual([]);
  });

  it("summarises by person, page and day", async () => {
    const people = await asUser(db, SYSADMIN, async (tx) =>
      (await tx.query<{ staff_id: string; sign_ins: number; failed_sign_ins: number; page_views: number; changes: number; last_seen: string | null }>(
        `select * from usage_by_person('${TODAY}', '${TODAY}')`,
      )).rows,
    );
    const officer = people.find((p) => p.staff_id === OFFICER_LAGOS)!;
    expect(officer).toMatchObject({ sign_ins: 1, failed_sign_ins: 1, page_views: 2, changes: 0 });
    // Active staff with nothing logged are still listed, so you can see who isn't using the ERP.
    expect(people.find((p) => p.staff_id === AUDITOR_SOUTH)).toMatchObject({ page_views: 0, last_seen: null });

    const pages = await asUser(db, SYSADMIN, async (tx) =>
      (await tx.query<{ label: string; views: number; people: number }>(`select * from usage_by_page('${TODAY}', '${TODAY}')`)).rows,
    );
    expect(pages[0]).toMatchObject({ label: "Members", views: 2, people: 1 });

    const days = await asUser(db, SYSADMIN, async (tx) =>
      (await tx.query<{ people: number; page_views: number; changes: number }>(`select * from usage_by_day('${TODAY}', '${TODAY}')`)).rows,
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ people: 3, page_views: 4, changes: 1 });

    expect(await asUser(db, OFFICER_LAGOS, async (tx) => (await tx.query(`select * from usage_by_person('${TODAY}', '${TODAY}')`)).rows)).toEqual([]);
  });
});
