import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, asUser, createTestDatabase } from "./harness";

const OFFICER_LAGOS = "00000000-0000-0000-0000-0000000000b1";
const MANAGER_ABUJA = "00000000-0000-0000-0000-0000000000b2";
const AUDITOR_SOUTH = "00000000-0000-0000-0000-0000000000b3";
const ADMIN_ALL = "00000000-0000-0000-0000-0000000000b4";
const LEFT = "00000000-0000-0000-0000-0000000000b5";

// The part of Supabase Realtime the migration uses: realtime.send() stores the broadcast in realtime.messages,
// and Realtime checks a listener's right to a topic by reading realtime.messages with realtime.topic() set.
const REALTIME_STUB = `
  create schema realtime;
  create table realtime.messages (
    id bigint generated always as identity primary key,
    topic text not null,
    extension text not null default 'broadcast',
    payload jsonb,
    event text,
    private boolean
  );
  alter table realtime.messages enable row level security;
  grant usage on schema realtime to authenticated;
  grant select on realtime.messages to authenticated;
  create function realtime.topic() returns text language sql stable as $$
    select nullif(current_setting('realtime.topic', true), '')
  $$;
  grant execute on function realtime.topic() to authenticated;
  create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql as $$
    insert into realtime.messages (topic, payload, event, private) values (topic, payload, event, private)
  $$;
`;

let db: PGlite;
let lagos: string;
let abuja: string;
let south: string;

async function addStaff(id: string, role: string, scope: { branch?: string; region?: string } = {}) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
  await db.query("insert into staff (id, full_name, email, department_code) values ($1, $2, $3, 'administration')", [
    id,
    `Person ${id.slice(-2)}`,
    `${id}@kuun.test`,
  ]);
  await db.query("insert into staff_roles (staff_id, role_code, branch_id, region_id) values ($1, $2, $3, $4)", [
    id,
    role,
    scope.branch ?? null,
    scope.region ?? null,
  ]);
}

async function sent(): Promise<{ topic: string; event: string; payload: unknown; private: boolean }[]> {
  return (await db.query<{ topic: string; event: string; payload: unknown; private: boolean }>(
    "select topic, event, payload, private from realtime.messages order by id",
  )).rows;
}

/** As Realtime does when a browser joins a private channel: can this staff member read the topic's messages? */
async function canWatch(userId: string, topic: string): Promise<boolean> {
  return asUser(db, userId, async (tx) => {
    await tx.query("select set_config('realtime.topic', $1, true)", [topic]);
    const res = await tx.query<{ n: number }>("select count(*)::int as n from realtime.messages where topic = $1", [topic]);
    return res.rows[0].n > 0;
  });
}

async function addMember(branchId: string, nin: string, introducedBy: string | null = null): Promise<string> {
  // created_by comes from the signed-in user.
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ADMIN_ALL]);
  const res = await db.query<{ id: string }>(
    `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
     values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', $2, 'national_id', 'A123') returning id`,
    [branchId, nin],
  );
  if (introducedBy) {
    await db.exec("begin; select app.begin_workflow();");
    await db.query("update members set introduced_by = $2 where id = $1", [res.rows[0].id, introducedBy]);
    await db.exec("select app.end_workflow(); commit;");
  }
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  return res.rows[0].id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(REALTIME_STUB);
  // Run the migration again now that Realtime exists, so its listener policy is created.
  await applyMigrations(db, { from: "20261116000090" });

  south = (await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id")).rows[0].id;
  const north = (await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id")).rows[0].id;
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [south])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [north])).rows[0].id;

  await addStaff(OFFICER_LAGOS, "admin_officer", { branch: lagos });
  await addStaff(MANAGER_ABUJA, "branch_manager", { branch: abuja });
  await addStaff(AUDITOR_SOUTH, "internal_auditor", { region: south });
  await addStaff(ADMIN_ALL, "system_admin");
  await addStaff(LEFT, "admin_officer", { branch: lagos });
  await db.query("update staff set is_active = false where id = $1", [LEFT]);
});

beforeEach(async () => {
  await db.exec("delete from realtime.messages");
});

describe("live update signals", () => {
  it("sends one empty 'changed' signal to the branch topic per transaction", async () => {
    await db.exec("begin");
    await addMember(lagos, "90000000001");
    await addMember(lagos, "90000000002");
    await db.exec("commit");
    expect(await sent()).toEqual([{ topic: `erp:branch:${lagos}`, event: "changed", payload: {}, private: true }]);
  });

  it("sends changes with no branch to the organisation topic", async () => {
    await db.query("insert into public_holidays (holiday_date, name) values ('2026-12-30', 'Test holiday')");
    expect((await sent()).map((m) => m.topic)).toEqual(["erp:org"]);
  });

  it("also tells the staff member who brought the client in, wherever the client is", async () => {
    const member = await addMember(abuja, "90000000003", OFFICER_LAGOS);
    await db.exec("delete from realtime.messages");
    await db.query("update members set phone = '08039999999' where id = $1", [member]);
    expect((await sent()).map((m) => m.topic).sort()).toEqual([`erp:branch:${abuja}`, `erp:staff:${OFFICER_LAGOS}`].sort());
  });

  it("never blocks the change when Realtime fails", async () => {
    await db.exec(`create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
      returns void language plpgsql as $$ begin raise exception 'realtime down'; end $$`);
    try {
      await addMember(lagos, "90000000004");
      expect((await db.query("select 1 from members where nin = '90000000004'")).rows).toHaveLength(1);
    } finally {
      await db.exec(`create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
        returns void language sql as $$
          insert into realtime.messages (topic, payload, event, private) values (topic, payload, event, private)
        $$`);
    }
  });
});

describe("who may listen", () => {
  beforeEach(async () => {
    for (const topic of ["erp:org", `erp:branch:${lagos}`, `erp:branch:${abuja}`, `erp:staff:${OFFICER_LAGOS}`, "erp:anything"]) {
      await db.query("select realtime.send('{}'::jsonb, 'changed', $1, true)", [topic]);
    }
  });

  it("lets staff join their own branches, the organisation and their own topic only", async () => {
    expect(await canWatch(OFFICER_LAGOS, "erp:org")).toBe(true);
    expect(await canWatch(OFFICER_LAGOS, `erp:branch:${lagos}`)).toBe(true);
    expect(await canWatch(OFFICER_LAGOS, `erp:branch:${abuja}`)).toBe(false);
    expect(await canWatch(OFFICER_LAGOS, `erp:staff:${OFFICER_LAGOS}`)).toBe(true);
    expect(await canWatch(MANAGER_ABUJA, `erp:staff:${OFFICER_LAGOS}`)).toBe(false);
    expect(await canWatch(MANAGER_ABUJA, `erp:branch:${abuja}`)).toBe(true);
    expect(await canWatch(OFFICER_LAGOS, "erp:anything")).toBe(false);
  });

  it("follows regional and organisation-wide roles", async () => {
    expect(await canWatch(AUDITOR_SOUTH, `erp:branch:${lagos}`)).toBe(true);
    expect(await canWatch(AUDITOR_SOUTH, `erp:branch:${abuja}`)).toBe(false);
    expect(await canWatch(ADMIN_ALL, `erp:branch:${abuja}`)).toBe(true);
  });

  it("shuts out staff who have left", async () => {
    expect(await canWatch(LEFT, "erp:org")).toBe(false);
    expect(await canWatch(LEFT, `erp:branch:${lagos}`)).toBe(false);
  });

  it("lists the topics a staff member should join", async () => {
    const topics = (id: string) =>
      asUser(db, id, async (tx) => (await tx.query<{ t: string[] }>("select public.my_live_topics() as t")).rows[0].t);
    expect(await topics(OFFICER_LAGOS)).toEqual(["erp:org", `erp:staff:${OFFICER_LAGOS}`, `erp:branch:${lagos}`]);
    expect(await topics(AUDITOR_SOUTH)).toEqual(["erp:org", `erp:staff:${AUDITOR_SOUTH}`, `erp:branch:${lagos}`]);
    expect(await topics(ADMIN_ALL)).toEqual(["erp:org", `erp:staff:${ADMIN_ALL}`, `erp:branch:${abuja}`, `erp:branch:${lagos}`]);
    expect(await topics(LEFT)).toEqual([]);
  });
});
