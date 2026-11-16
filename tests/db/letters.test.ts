import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";

// Kuun's plan rates from the library, and the Branch Manager who signs the letters.

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const OFFICER = "00000000-0000-0000-0000-0000000002a1";
const MARKETER = "00000000-0000-0000-0000-0000000002e9";
const MANAGER = "00000000-0000-0000-0000-0000000002b1";
const LATER_MANAGER = "00000000-0000-0000-0000-0000000002b2";

let db: PGlite;
let lagos: string;
let abuja: string;
let memberId: string;

async function addStaff(id: string, name: string, department: string, role: string, branchId: string | null) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
  await db.query("insert into staff (id, full_name, email, department_code) values ($1, $2, $3, $4)", [
    id,
    name,
    `${id}@kuun.test`,
    department,
  ]);
  await db.query("insert into staff_roles (staff_id, role_code, branch_id) values ($1, $2, $3)", [id, role, branchId]);
}

async function commitAs<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`begin; set local role authenticated; set local request.jwt.claim.sub = '${userId}';`);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

function openPlan(planType: string, amount: number) {
  return commitAs(OFFICER, () =>
    db.query<{ id: string; interest_rate: string }>(
      `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
       values ($1, $2, $3, $4, 'one_off', current_date, (current_date + interval '12 months')::date) returning id, interest_rate`,
      [memberId, lagos, planType, amount],
    ),
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  const r = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [r.rows[0].id])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [r.rows[0].id])).rows[0].id;

  await addStaff(OFFICER, "Olu Officer", "administration", "admin_officer", lagos);
  await addStaff(MARKETER, "Mo Marketer", "administration", "marketer", lagos);
  await addStaff(MANAGER, "Elfrida Nledo", "branch_operations", "branch_manager", lagos);

  memberId = (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
         values ($1, 'Ake', 'Ebimzo', '08030000000', 'No 5, Mac Bento Close, Asokoro, Abuja', '41000000099', 'national_id', 'A123') returning id`,
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
  await commitAs(OFFICER, () => db.query("select send_member_to_marketer($1)", [memberId]));
  await commitAs(MARKETER, () => db.query("select marketer_review_member($1, null)", [memberId]));
  await commitAs(OFFICER, () => db.query("select submit_member($1)", [memberId]));
  await commitAs(MANAGER, () => db.query("select approve_member($1, $2)", [memberId, SIG]));
});

describe("Kuun's plan rates", () => {
  it("opens plans at the library's monthly rates, kept as annual figures", async () => {
    // 4%, 5%, 6% and 5% a month.
    expect((await openPlan("silver", 300000)).rows[0].interest_rate).toBe("48.00");
    expect((await openPlan("gold", 1000000)).rows[0].interest_rate).toBe("60.00");
    expect((await openPlan("platinum", 35000000)).rows[0].interest_rate).toBe("72.00");
  });

  it("offers Kuun Exploit at 3.5% a month for 5,000,000 to 50,000,000 naira", async () => {
    await expect(openPlan("exploit", 4999999)).rejects.toThrow(/at least 5,000,000\.00/);
    await expect(openPlan("exploit", 50000001)).rejects.toThrow(/at most 50,000,000\.00/);
    expect((await openPlan("exploit", 20000000)).rows[0].interest_rate).toBe("42.00");
  });

  it("pays a month's interest at the letter's rate", async () => {
    // The Platinum sample: 17,500,000 at 6% a month is 1,050,000.
    const res = await db.query<{ monthly: string }>(
      "select round(17500000 * interest_rate / 100 / 12, 2) as monthly from plan_types where code = 'platinum'",
    );
    expect(res.rows[0].monthly).toBe("1050000.00");
  });
});

describe("who signs the letters", () => {
  it("names the branch's Branch Manager, the longest serving one first", async () => {
    await addStaff(LATER_MANAGER, "Bisi Later", "branch_operations", "branch_manager", lagos);
    const res = await commitAs(OFFICER, () =>
      db.query<{ lagos: string | null; abuja: string | null }>(
        "select branch_manager_name($1) as lagos, branch_manager_name($2) as abuja",
        [lagos, abuja],
      ),
    );
    expect(res.rows[0]).toEqual({ lagos: "Elfrida Nledo", abuja: null });
  });

  it("skips a manager who has left", async () => {
    await db.query("update staff set is_active = false where id = $1", [MANAGER]);
    const res = await commitAs(OFFICER, () => db.query<{ name: string }>("select branch_manager_name($1) as name", [lagos]));
    expect(res.rows[0].name).toBe("Bisi Later");
    await db.query("update staff set is_active = true where id = $1", [MANAGER]);
  });
});
