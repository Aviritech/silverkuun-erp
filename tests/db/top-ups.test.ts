import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const OFFICER = "00000000-0000-0000-0000-0000000001a1";
const ABUJA_OFFICER = "00000000-0000-0000-0000-0000000001a2";
const MARKETER = "00000000-0000-0000-0000-0000000001e9";
const MANAGER = "00000000-0000-0000-0000-0000000001b1";
const LAGOS_ACCOUNTANT = "00000000-0000-0000-0000-0000000001e1";
const ABUJA_RECEIPTS = "00000000-0000-0000-0000-0000000001e3";
const HQ_RECEIPTS = "00000000-0000-0000-0000-0000000001f1";

let db: PGlite;
let lagos: string;
let abuja: string;
let lagosBank: string;
let abujaBank: string;
let planId: string;

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

type TopUp = { id: string; top_up_no: string; status: string; branch_id: string; contribution_id: string | null; decision_note: string | null };

function initiate(by: string, branch: string, opts: { id?: string; amount?: number; bank?: string | null; paidOn?: string } = {}) {
  return commitAs(by, () =>
    db.query<TopUp>(
      `select * from initiate_top_up($1, $2, $3, coalesce($4::date, current_date - 1), 'bank_transfer', 'TRF-777', $5, 'Ada Obi', 'Seen on the statement')`,
      [opts.id ?? null, branch, opts.amount ?? 15000, opts.paidOn ?? null, opts.bank === undefined ? null : opts.bank],
    ),
  ).then((r) => r.rows[0]);
}

beforeAll(async () => {
  db = await createTestDatabase();
  const r1 = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  const r2 = await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [r1.rows[0].id])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [r2.rows[0].id])).rows[0].id;

  await addStaff(OFFICER, "administration", "admin_officer", lagos);
  await addStaff(ABUJA_OFFICER, "administration", "admin_officer", abuja);
  await addStaff(MARKETER, "administration", "marketer", lagos);
  await addStaff(MANAGER, "branch_operations", "branch_manager", lagos);
  await addStaff(LAGOS_ACCOUNTANT, "accounts", "regional_accountant", lagos);
  await addStaff(ABUJA_RECEIPTS, "accounts", "receipts_accountant", abuja);
  await addStaff(HQ_RECEIPTS, "accounts", "receipts_accountant", null);

  await db.exec(`
    insert into ledger_accounts (code, name, account_type, parent_code, cash_flow_class) values
      ('1131', 'Lagos bank', 'asset', '1130', 'cash'), ('1132', 'Abuja bank', 'asset', '1130', 'cash');
  `);
  lagosBank = (await db.query<{ id: string }>("insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Lagos', '1131') returning id", [lagos])).rows[0].id;
  abujaBank = (await db.query<{ id: string }>("insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Abuja', '1132') returning id", [abuja])).rows[0].id;

  const memberId = (
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
  await commitAs(OFFICER, () => db.query("select send_member_to_marketer($1)", [memberId]));
  await commitAs(MARKETER, () => db.query("select marketer_review_member($1, null)", [memberId]));
  await commitAs(OFFICER, () => db.query("select submit_member($1)", [memberId]));
  await commitAs(MANAGER, () => db.query("select approve_member($1, $2)", [memberId, SIG]));
  planId = (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
         values ($1, $2, 'gold', 5000, 'monthly', current_date - 60, current_date + 365) returning id`,
        [memberId, lagos],
      ),
    )
  ).rows[0].id;
});

describe("top ups from Accounts", () => {
  it("Operations can't record a top-up on its own any more", async () => {
    await expect(
      commitAs(OFFICER, () =>
        db.query(
          `insert into contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method)
           select id, member_id, branch_id, 'top_up', 1000, current_date, 'cash' from member_plans where id = $1`,
          [planId],
        ),
      ),
    ).rejects.toThrow(/top ups come from Accounts/);
  });

  it("goes Accounts → branch officer → Branch Manager → Accounts posting, with Accounts' amount and reference", async () => {
    const t = await initiate(LAGOS_ACCOUNTANT, lagos, { bank: lagosBank });
    expect(t.status).toBe("with_branch");
    expect(t.top_up_no).toMatch(/^TOP-\d{6}$/);

    // The branch sees it in its queue; another branch doesn't.
    const queue = await commitAs(OFFICER, () => db.query<{ id: string; bank_account_name: string }>("select * from top_up_list(array['with_branch'])"));
    expect(queue.rows.map((r) => r.id)).toContain(t.id);
    expect(queue.rows.find((r) => r.id === t.id)?.bank_account_name).toBe("Lagos");
    const abujaQueue = await commitAs(ABUJA_OFFICER, () => db.query<{ id: string }>("select id from top_up_list(null)"));
    expect(abujaQueue.rows.map((r) => r.id)).not.toContain(t.id);
    await expect(commitAs(ABUJA_OFFICER, () => db.query("select log_top_up($1, $2, null)", [t.id, planId]))).rejects.toThrow(/not found/);

    // Nobody edits the row directly.
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("update top_up_requests set amount = 1 where id = $1", [t.id]));
    await expect(
      commitAs(LAGOS_ACCOUNTANT, () => db.query("insert into top_up_requests (top_up_no, branch_id, amount, paid_on, payment_method, paid_by, requested_by) values ('TOP-X', $1, 1, current_date, 'cash', 'Someone', $2)", [lagos, LAGOS_ACCOUNTANT])),
    ).rejects.toThrow();
    expect((await db.query<{ amount: string }>("select amount from top_up_requests where id = $1", [t.id])).rows[0].amount).toBe("15000.00");

    const logged = (await commitAs(OFFICER, () => db.query<TopUp>("select * from log_top_up($1, $2, 'Member called to confirm')", [t.id, planId]))).rows[0];
    expect(logged.status).toBe("logged");
    const c = (
      await db.query<{ kind: string; amount: string; reference: string; recorded_by: string; verified_at: string | null; notes: string }>(
        "select kind, amount, reference, recorded_by, verified_at, notes from contributions where id = $1",
        [logged.contribution_id],
      )
    ).rows[0];
    expect(c).toMatchObject({ kind: "top_up", amount: "15000.00", reference: "TRF-777", recorded_by: OFFICER, verified_at: null });
    expect(c.notes).toContain(t.top_up_no);

    // Can't be logged twice.
    await expect(commitAs(OFFICER, () => db.query("select log_top_up($1, $2, null)", [t.id, planId]))).rejects.toThrow(/isn't waiting/);

    // The usual path from here: the Branch Manager verifies, then Accounts can post it.
    await commitAs(MANAGER, () => db.query("select verify_contribution($1)", [logged.contribution_id]));
    const awaiting = await commitAs(LAGOS_ACCOUNTANT, () =>
      db.query<{ id: string; kind: string }>("select id, kind from contributions_awaiting_posting where id = $1", [logged.contribution_id]),
    );
    expect(awaiting.rows).toEqual([{ id: logged.contribution_id, kind: "top_up" }]);

    // Once Accounts raises the receipt, the top up shows it.
    await commitAs(LAGOS_ACCOUNTANT, () =>
      db.query(
        `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, member_id, reference, description, branch_id, contribution_id)
         select 'receipt', 'member_savings', paid_on, amount, $2, member_id, reference, 'Top-up', branch_id, id from contributions where id = $1`,
        [logged.contribution_id, lagosBank],
      ),
    );
    const listed = await commitAs(OFFICER, () =>
      db.query<{ contribution_verified: boolean; contribution_status: string }>("select contribution_verified, contribution_status from top_up_list(array['logged']) where id = $1", [t.id]),
    );
    expect(listed.rows[0]).toEqual({ contribution_verified: true, contribution_status: "draft" });
  });

  it("only goes to branches the accountant records receipts for, into that branch's own accounts", async () => {
    await expect(initiate(LAGOS_ACCOUNTANT, abuja)).rejects.toThrow(/choose a branch/);
    await expect(initiate(LAGOS_ACCOUNTANT, lagos, { bank: abujaBank })).rejects.toThrow(/that branch's active accounts/);
    await expect(initiate(LAGOS_ACCOUNTANT, lagos, { paidOn: "2999-01-01" })).rejects.toThrow(/future/);
    await expect(initiate(OFFICER, lagos)).rejects.toThrow(/choose a branch/);
    // An accountant whose role covers every branch picks any of them.
    expect((await initiate(HQ_RECEIPTS, abuja)).branch_id).toBe(abuja);
  });

  it("can be sent back by the branch, then redirected to another branch or cancelled by Accounts", async () => {
    const t = await initiate(HQ_RECEIPTS, lagos);
    await expect(commitAs(OFFICER, () => db.query("select return_top_up($1, '')", [t.id]))).rejects.toThrow(/say why/);
    const returned = (await commitAs(OFFICER, () => db.query<TopUp>("select * from return_top_up($1, 'No member by that name here')", [t.id]))).rows[0];
    expect(returned).toMatchObject({ status: "returned", decision_note: "No member by that name here" });

    // Resent to Abuja, it leaves Lagos's queue and lands in Abuja's.
    const resent = await initiate(HQ_RECEIPTS, abuja, { id: t.id });
    expect(resent).toMatchObject({ id: t.id, status: "with_branch", branch_id: abuja });
    const lagosQueue = await commitAs(OFFICER, () => db.query<{ id: string }>("select id from top_up_list(array['with_branch'])"));
    expect(lagosQueue.rows.map((r) => r.id)).not.toContain(t.id);
    const abujaQueue = await commitAs(ABUJA_OFFICER, () => db.query<{ id: string }>("select id from top_up_list(array['with_branch'])"));
    expect(abujaQueue.rows.map((r) => r.id)).toContain(t.id);

    // A plan in another branch can't take it.
    await expect(commitAs(ABUJA_OFFICER, () => db.query("select log_top_up($1, $2, null)", [t.id, planId]))).rejects.toThrow(/plan in this branch/);

    // Only Accounts cancels, and not once it's logged.
    await expect(commitAs(ABUJA_OFFICER, () => db.query("select cancel_top_up($1, 'Not ours')", [t.id]))).rejects.toThrow(/not found/);
    await commitAs(ABUJA_RECEIPTS, () => db.query("select cancel_top_up($1, 'Customer was refunded')", [t.id]));
    const row = (await db.query<{ status: string }>("select status from top_up_requests where id = $1", [t.id])).rows[0];
    expect(row.status).toBe("cancelled");
    await expect(initiate(HQ_RECEIPTS, abuja, { id: t.id })).rejects.toThrow(/only a top up the branch sent back/);
  });
});
