import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const OFFICER = "00000000-0000-0000-0000-0000000000a1";
const MARKETER = "00000000-0000-0000-0000-0000000000e9";
const MANAGER = "00000000-0000-0000-0000-0000000000b1";
const ABUJA_MANAGER = "00000000-0000-0000-0000-0000000000b2";
const ACCOUNTANT = "00000000-0000-0000-0000-0000000000e1";
const HEAD_OPS = "00000000-0000-0000-0000-0000000000c1";

let db: PGlite;
let lagos: string;
let abuja: string;
let bank: string;
let member: string;
let plan: string;
let submitted: string;
let drafted: string;

async function addStaff(id: string, department: string, role: string, branchId: string | null) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
  await db.query("insert into staff (id, full_name, email, department_code) values ($1::uuid, $1::text, $2, $3)", [
    id,
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

async function receipt(amount: number): Promise<string> {
  const id = (
    await commitAs(ACCOUNTANT, () =>
      db.query<{ id: string }>(
        `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, member_id, member_plan_id,
           reference, description, branch_id)
         values ('receipt', 'member_savings', current_date, $1, $2, $3, $4, $5, 'Savings', $6) returning id`,
        [amount, bank, member, plan, `REF-${amount}`, lagos],
      ),
    )
  ).rows[0].id;
  await commitAs(ACCOUNTANT, () =>
    db.query(
      `insert into finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
       values ($1, $2, 'supporting', 'e.pdf', $3, 'application/pdf', 100)`,
      [id, lagos, `${lagos}/${id}/e.pdf`],
    ),
  );
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const r1 = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  const r2 = await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [r1.rows[0].id])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [r2.rows[0].id])).rows[0].id;

  await addStaff(OFFICER, "administration", "admin_officer", lagos);
  await addStaff(MARKETER, "administration", "marketer", lagos);
  await addStaff(MANAGER, "branch_operations", "branch_manager", lagos);
  await addStaff(ABUJA_MANAGER, "branch_operations", "branch_manager", abuja);
  await addStaff(ACCOUNTANT, "accounts", "regional_accountant", lagos);
  await addStaff(HEAD_OPS, "administration", "head_of_administration", null);

  await db.exec("insert into ledger_accounts (code, name, account_type, parent_code, cash_flow_class) values ('1131', 'Lagos bank', 'asset', '1130', 'cash')");
  bank = (await db.query<{ id: string }>("insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Lagos', '1131') returning id", [lagos])).rows[0].id;

  member = (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
         values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', '30000000001', 'national_id', 'A123') returning id`,
        [lagos],
      ),
    )
  ).rows[0].id;
  for (const t of ["kyc_form", "nin_slip", "means_of_id", "utility_bill"]) {
    await commitAs(OFFICER, () =>
      db.query(
        `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
         values ($1, $2, $3, 'f.pdf', $4, 'application/pdf', 1000)`,
        [member, lagos, t, `${lagos}/${member}/${t}.pdf`],
      ),
    );
  }
  await commitAs(OFFICER, () => db.query("select send_member_to_marketer($1)", [member]));
  await commitAs(MARKETER, () => db.query("select marketer_review_member($1, null)", [member]));
  await commitAs(OFFICER, () => db.query("select submit_member($1)", [member]));
  await commitAs(MANAGER, () => db.query("select approve_member($1, $2)", [member, SIG]));
  plan = (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
         values ($1, $2, 'gold', 5000, 'monthly', current_date - 60, current_date + 365) returning id`,
        [member, lagos],
      ),
    )
  ).rows[0].id;

  submitted = await receipt(50000);
  await commitAs(ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [submitted]));
  drafted = await receipt(7000);
});

describe("a Branch Manager reviewing a member", () => {
  it("sees the member's receipts and payments past draft, with the plan they went to", async () => {
    const res = await asUser(db, MANAGER, (tx) =>
      tx.query<{ id: string; status: string; type_name: string; plan_name: string; amount: string }>(
        "select * from member_money_history($1)",
        [member],
      ),
    );
    expect(res.rows.map((r) => r.id)).toEqual([submitted]);
    expect(res.rows[0]).toMatchObject({ status: "submitted", plan_name: "Gold", amount: "50000.00" });
    expect(res.rows.map((r) => r.id)).not.toContain(drafted);
  });

  it("sees the history of the file: who created, sent, approved it and added the plan", async () => {
    const res = await asUser(db, MANAGER, (tx) =>
      tx.query<{ record_type: string; action: string; status: string | null; actor_id: string }>(
        "select * from member_history($1)",
        [member],
      ),
    );
    const members = res.rows.filter((r) => r.record_type === "members");
    expect(members.map((r) => r.status).filter(Boolean)).toEqual(
      expect.arrayContaining(["draft", "with_marketer", "marketer_reviewed", "pending_approval", "approved"]),
    );
    expect(res.rows.some((r) => r.record_type === "member_plans" && r.action === "INSERT")).toBe(true);
    expect(res.rows.filter((r) => r.record_type === "member_documents")).toHaveLength(4);
    expect(members.find((r) => r.status === "approved")?.actor_id).toBe(MANAGER);
  });

  it("can read the branch's loans, but not another branch's", async () => {
    const res = await asUser(db, MANAGER, (tx) =>
      tx.query<{ lagos: boolean; abuja: boolean }>(
        "select app.has_branch_permission('credit.read', $1) as lagos, app.has_branch_permission('credit.read', $2) as abuja",
        [lagos, abuja],
      ),
    );
    expect(res.rows[0]).toEqual({ lagos: true, abuja: false });
    await asUser(db, MANAGER, (tx) => tx.query("select * from loan_book where member_id = $1", [member]));
  });

  it("is limited to their own branch, and officers without the permission get nothing", async () => {
    for (const who of [ABUJA_MANAGER, OFFICER, MARKETER]) {
      const money = await asUser(db, who, (tx) => tx.query("select * from member_money_history($1)", [member]));
      const history = await asUser(db, who, (tx) => tx.query("select * from member_history($1)", [member]));
      expect(money.rows).toHaveLength(0);
      expect(history.rows).toHaveLength(0);
    }
    const head = await asUser(db, HEAD_OPS, (tx) => tx.query("select * from member_money_history($1)", [member]));
    expect(head.rows).toHaveLength(1);
  });
});
