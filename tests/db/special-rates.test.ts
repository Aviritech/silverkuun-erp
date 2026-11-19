import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const OFFICER = "00000000-0000-0000-0000-0000000001a1";
const OFFICER_2 = "00000000-0000-0000-0000-0000000001a2";
const MARKETER = "00000000-0000-0000-0000-0000000001e9";
const MANAGER = "00000000-0000-0000-0000-0000000001b1";
const HEAD_OPS = "00000000-0000-0000-0000-0000000001c1";
const REGIONAL = "00000000-0000-0000-0000-0000000001c2";
const OTHER_REGIONAL = "00000000-0000-0000-0000-0000000001c3";
const BDM = "00000000-0000-0000-0000-0000000001c4";
const CEO = "00000000-0000-0000-0000-0000000001c5";

let db: PGlite;
let lagos: string;
let southWest: string;
let northCentral: string;
let memberId: string;

async function addStaff(
  id: string,
  department: string,
  role: string,
  scope: { branch?: string; region?: string } = {},
) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [
    id,
    `${id}@kuun.test`,
  ]);
  await db.query(
    "insert into staff (id, full_name, email, department_code) values ($1::uuid, $1::text, $2, $3)",
    [id, `${id}@kuun.test`, department],
  );
  await db.query(
    "insert into staff_roles (staff_id, role_code, branch_id, region_id) values ($1, $2, $3, $4)",
    [id, role, scope.branch ?? null, scope.region ?? null],
  );
}

async function commitAs<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(
    `begin; set local role authenticated; set local request.jwt.claim.sub = '${userId}';`,
  );
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function newPlan(): Promise<string> {
  const res = await commitAs(OFFICER, () =>
    db.query<{ id: string }>(
      `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
       values ($1, $2, 'gold', 5000, 'monthly', current_date - 60, current_date + 365) returning id`,
      [memberId, lagos],
    ),
  );
  return res.rows[0].id;
}

type Req = {
  id: string;
  status: string;
  stage: string | null;
  requested_rate: string;
  current_rate: string;
};

async function request(
  planId: string,
  monthly: number,
  by = OFFICER,
): Promise<Req> {
  return (
    await commitAs(by, () =>
      db.query<Req>(
        "select * from request_plan_rate($1, $2, 'Long-standing member moving 50m from another bank')",
        [planId, monthly],
      ),
    )
  ).rows[0];
}

async function decide(
  by: string,
  id: string,
  approve = true,
  note: string | null = null,
): Promise<Req> {
  return (
    await commitAs(by, () =>
      db.query<Req>("select * from decide_plan_rate($1, $2, $3)", [
        id,
        approve,
        note,
      ]),
    )
  ).rows[0];
}

async function planRate(
  planId: string,
): Promise<{ interest_rate: string; special_rate_request_id: string | null }> {
  return (
    await db.query<{
      interest_rate: string;
      special_rate_request_id: string | null;
    }>(
      "select interest_rate, special_rate_request_id from member_plans where id = $1",
      [planId],
    )
  ).rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
  southWest = (
    await db.query<{ id: string }>(
      "insert into regions (code, name) values ('SW', 'South West') returning id",
    )
  ).rows[0].id;
  northCentral = (
    await db.query<{ id: string }>(
      "insert into regions (code, name) values ('NC', 'North Central') returning id",
    )
  ).rows[0].id;
  lagos = (
    await db.query<{ id: string }>(
      "insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id",
      [southWest],
    )
  ).rows[0].id;

  await addStaff(OFFICER, "administration", "admin_officer", { branch: lagos });
  await addStaff(OFFICER_2, "administration", "admin_officer", {
    branch: lagos,
  });
  await addStaff(MARKETER, "administration", "marketer", { branch: lagos });
  await addStaff(MANAGER, "branch_operations", "branch_manager", {
    branch: lagos,
  });
  await addStaff(HEAD_OPS, "administration", "head_of_administration");
  await addStaff(REGIONAL, "branch_operations", "regional_manager", {
    region: southWest,
  });
  await addStaff(OTHER_REGIONAL, "branch_operations", "regional_manager", {
    region: northCentral,
  });
  await addStaff(BDM, "management", "bdm");
  await addStaff(CEO, "management", "ceo");

  memberId = (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
         values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', '41000000000', 'national_id', 'A123') returning id`,
        [lagos],
      ),
    )
  ).rows[0].id;
  for (const t of ["kyc_form", "nin_slip", "means_of_id", "utility_bill"]) {
    await commitAs(OFFICER, () =>
      db.query(
        `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
         values ($1, $2, $3, 'f.pdf', $4, 'application/pdf', 1000)`,
        [memberId, lagos, t, `${lagos}/${memberId}/${t}.pdf`],
      ),
    );
  }
  await commitAs(OFFICER, () =>
    db.query("select send_member_to_marketer($1)", [memberId]),
  );
  await commitAs(MARKETER, () =>
    db.query("select marketer_review_member($1, null)", [memberId]),
  );
  await commitAs(OFFICER, () =>
    db.query("select submit_member($1)", [memberId]),
  );
  await commitAs(MANAGER, () =>
    db.query("select approve_member($1, $2)", [memberId, SIG]),
  );
});

describe("special plan rates", () => {
  it("go officer, Branch Manager, Head of Operations, Regional Manager, BDM, then the CEO sets the plan's rate", async () => {
    const plan = await newPlan();
    expect((await planRate(plan)).interest_rate).toBe("60.00");

    const r = await request(plan, 6);
    expect(r).toMatchObject({
      status: "pending",
      stage: "branch_manager",
      current_rate: "60.00",
      requested_rate: "72.00",
    });

    // Out of turn: the CEO can't jump the queue, and the rate isn't touched yet.
    await expect(decide(CEO, r.id)).rejects.toThrow(
      /waiting for the branch manager/,
    );

    expect((await decide(MANAGER, r.id)).stage).toBe("head_of_operations");
    expect((await decide(HEAD_OPS, r.id)).stage).toBe("regional_manager");
    // Only the Regional Manager of the branch's region.
    await expect(decide(OTHER_REGIONAL, r.id)).rejects.toThrow(/not found/);
    expect((await decide(REGIONAL, r.id)).stage).toBe("bdm");
    expect((await decide(BDM, r.id)).stage).toBe("ceo");
    expect((await planRate(plan)).interest_rate).toBe("60.00");

    const done = await decide(CEO, r.id, true, "Approved for this deposit");
    expect(done).toMatchObject({ status: "approved", stage: null });
    expect(await planRate(plan)).toEqual({
      interest_rate: "72.00",
      special_rate_request_id: r.id,
    });

    const approvals = await db.query<{ stage: string }>(
      "select stage from plan_rate_approvals where request_id = $1 order by approved_at",
      [r.id],
    );
    expect(approvals.rows.map((a) => a.stage)).toEqual([
      "branch_manager",
      "head_of_operations",
      "regional_manager",
      "bdm",
      "ceo",
    ]);

    // The Special rates page shows every step that approved it.
    const list = await asUser(db, MANAGER, (tx) =>
      tx.query<{ requested_rate: string; approvals: unknown[] }>(
        "select requested_rate, approvals from plan_rate_request_list() where id = $1",
        [r.id],
      ),
    );
    expect(list.rows[0].approvals).toHaveLength(5);
  });

  it("needs a reason, a real change, and one open request per plan", async () => {
    const plan = await newPlan();
    await expect(
      commitAs(OFFICER, () =>
        db.query("select request_plan_rate($1, 6, 'no')", [plan]),
      ),
    ).rejects.toThrow(/say why/);
    await expect(request(plan, 5)).rejects.toThrow(/already the plan's rate/);
    await expect(request(plan, 9)).rejects.toThrow(/at most 8.33/);
    await expect(request(plan, 6, MANAGER)).rejects.toThrow(
      /only an Operations officer/,
    );
    await request(plan, 6);
    await expect(request(plan, 5.5)).rejects.toThrow(/already waiting/);
  });

  it("can't be approved by the person who asked or by anyone twice", async () => {
    const plan = await newPlan();
    // The Head of Operations also holds the Branch Manager role here, so could take two steps.
    await db.query(
      "insert into staff_roles (staff_id, role_code, branch_id) values ($1, 'branch_manager', $2)",
      [HEAD_OPS, lagos],
    );
    try {
      const r = await request(plan, 5.5);
      await decide(HEAD_OPS, r.id);
      await expect(decide(HEAD_OPS, r.id)).rejects.toThrow(
        /can't approve it again/,
      );
    } finally {
      await db.query(
        "delete from staff_roles where staff_id = $1 and role_code = 'branch_manager'",
        [HEAD_OPS],
      );
    }
  });

  it("ends on a decline with a reason, or when the officer cancels it, leaving the rate alone", async () => {
    const plan = await newPlan();
    const r = await request(plan, 5.5);
    await decide(MANAGER, r.id);
    await expect(decide(HEAD_OPS, r.id, false)).rejects.toThrow(
      /reason for declining/,
    );
    const declined = await decide(
      HEAD_OPS,
      r.id,
      false,
      "Too high for this amount",
    );
    expect(declined).toMatchObject({ status: "declined", stage: null });
    await expect(decide(REGIONAL, r.id)).rejects.toThrow(/already declined/);

    const again = await request(plan, 5.25, OFFICER_2);
    await expect(
      commitAs(OFFICER, () =>
        db.query("select cancel_plan_rate($1, 'x')", [again.id]),
      ),
    ).rejects.toThrow(/say why/);
    const cancelled = (
      await commitAs(OFFICER, () =>
        db.query<Req>(
          "select * from cancel_plan_rate($1, 'Member changed their mind')",
          [again.id],
        ),
      )
    ).rows[0];
    expect(cancelled.status).toBe("cancelled");
    expect((await planRate(plan)).interest_rate).toBe("60.00");
  });

  it("can't be written to directly", async () => {
    const plan = await newPlan();
    const r = await request(plan, 5.5);
    // Row security hides them from direct writes, and the guards refuse them outside the workflow.
    await commitAs(CEO, () =>
      db.query(
        "update plan_rate_requests set status = 'approved' where id = $1",
        [r.id],
      ),
    );
    await commitAs(CEO, () =>
      db.query("update member_plans set interest_rate = 90 where id = $1", [
        plan,
      ]),
    );
    await expect(
      db.query(
        "update plan_rate_requests set status = 'approved' where id = $1",
        [r.id],
      ),
    ).rejects.toThrow(/only through/);
    const row = await db.query<{ status: string }>(
      "select status from plan_rate_requests where id = $1",
      [r.id],
    );
    expect(row.rows[0].status).toBe("pending");
    expect((await planRate(plan)).interest_rate).toBe("60.00");
  });
});
