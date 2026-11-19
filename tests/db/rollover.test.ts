import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const OFFICER = "00000000-0000-0000-0000-0000000002a1";
const MARKETER = "00000000-0000-0000-0000-0000000002e9";
const MANAGER = "00000000-0000-0000-0000-0000000002b1";
const ACCOUNTANT = "00000000-0000-0000-0000-0000000002e1";
const CONFIRMER = "00000000-0000-0000-0000-0000000002e5";

let db: PGlite;
let lagos: string;
let memberId: string;

async function addStaff(
  id: string,
  department: string,
  role: string,
  branchId: string | null,
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
    "insert into staff_roles (staff_id, role_code, branch_id) values ($1, $2, $3)",
    [id, role, branchId],
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

/** A plan that started `months` months before `maturityAgo` days ago and matured then, with one verified deposit. */
async function maturedPlan(
  planType: string,
  months: number,
  amount: number,
  maturityAgo = 3,
): Promise<string> {
  const plan = (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date,
           maturity_date, interest_pay_day)
         select $1, $2, $3, $4, 'one_off', s, (s + make_interval(months => $5))::date, 10
         from (select (current_date - $6::int - make_interval(months => $5))::date as s) d
         returning id`,
        [memberId, lagos, planType, amount, months, maturityAgo],
      ),
    )
  ).rows[0].id;
  const c = await commitAs(OFFICER, () =>
    db.query<{ id: string }>(
      `insert into contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method)
       select id, member_id, branch_id, 'scheduled', $2, start_date, 'bank_transfer' from member_plans where id = $1 returning id`,
      [plan, amount],
    ),
  );
  await commitAs(MANAGER, () =>
    db.query("select verify_contribution($1)", [c.rows[0].id]),
  );
  return plan;
}

type Rollover = {
  id: string;
  status: string;
  capital: string | null;
  earnings: string | null;
  new_plan_id: string | null;
};

async function ask(
  plan: string,
  months: number,
  withEarnings = false,
): Promise<Rollover> {
  return (
    await commitAs(OFFICER, () =>
      db.query<Rollover>(
        "select * from request_plan_rollover($1, $2, $3, 'Member signed the roll-over form')",
        [plan, months, withEarnings],
      ),
    )
  ).rows[0];
}

async function approve(id: string): Promise<Rollover> {
  return (
    await commitAs(MANAGER, () =>
      db.query<Rollover>("select * from decide_plan_rollover($1, true, null)", [
        id,
      ]),
    )
  ).rows[0];
}

async function savings(plan: string): Promise<string> {
  return (
    await db.query<{ s: string }>(
      "select coalesce(sum(amount), 0)::numeric(16,2)::text as s from contributions where member_plan_id = $1 and verified_at is not null",
      [plan],
    )
  ).rows[0].s;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const region = (
    await db.query<{ id: string }>(
      "insert into regions (code, name) values ('SW', 'South West') returning id",
    )
  ).rows[0].id;
  lagos = (
    await db.query<{ id: string }>(
      "insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id",
      [region],
    )
  ).rows[0].id;
  await addStaff(OFFICER, "administration", "admin_officer", lagos);
  await addStaff(MARKETER, "administration", "marketer", lagos);
  await addStaff(MANAGER, "branch_operations", "branch_manager", lagos);
  await addStaff(ACCOUNTANT, "accounts", "regional_accountant", lagos);
  await addStaff(CONFIRMER, "accounts", "receipts_confirmer", null);
  await db.query(
    "insert into staff_roles (staff_id, role_code) values ($1, 'accounts_officer')",
    [CONFIRMER],
  );
  await db.exec(
    "insert into ledger_accounts (code, name, account_type, parent_code, cash_flow_class) values ('1131', 'Lagos bank', 'asset', '1130', 'cash')",
  );
  await db.query(
    "insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Lagos', '1131')",
    [lagos],
  );

  memberId = (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
         values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', '42000000000', 'national_id', 'A123') returning id`,
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

describe("roll-over at maturity", () => {
  it("moves a monthly plan's capital into a new plan from the maturity date, once the Branch Manager approves", async () => {
    const plan = await maturedPlan("gold", 12, 500000);
    await expect(ask(plan, 12, true)).rejects.toThrow(
      /paid monthly, so only the capital/,
    );
    const r = await ask(plan, 12);
    expect(r.status).toBe("pending");
    await expect(
      commitAs(OFFICER, () =>
        db.query("select decide_plan_rollover($1, true, null)", [r.id]),
      ),
    ).rejects.toThrow(/not found/);

    const done = await approve(r.id);
    expect(done).toMatchObject({
      status: "approved",
      capital: "500000.00",
      earnings: "0.00",
    });
    expect(await savings(plan)).toBe("0.00");
    expect(await savings(done.new_plan_id!)).toBe("500000.00");

    const plans = await db.query<{
      id: string;
      status: string;
      closed: boolean;
      start_date: string;
      rolled_over_from: string | null;
      interest_pay_day: number;
    }>(
      `select id, status::text, closed_at is not null as closed, start_date::text, rolled_over_from, interest_pay_day
       from member_plans where id in ($1, $2)`,
      [plan, done.new_plan_id],
    );
    const old = plans.rows.find((p) => p.id === plan)!;
    const fresh = plans.rows.find((p) => p.id === done.new_plan_id)!;
    expect(old).toMatchObject({ status: "matured", closed: true });
    expect(fresh).toMatchObject({
      status: "active",
      rolled_over_from: plan,
      interest_pay_day: 10,
    });
    const maturity = await db.query<{ m: string }>(
      "select maturity_date::text as m from member_plans where id = $1",
      [plan],
    );
    expect(fresh.start_date).toBe(maturity.rows[0].m);

    // The capital is already held, so it counts on the new plan's very first pay day.
    const due = await asUser(db, ACCOUNTANT, (tx) =>
      tx.query<{ total_savings: string }>(
        `select total_savings from interest_payment_schedule(
           (date_trunc('month', current_date) + interval '1 month' + interval '9 days')::date) where member_id = $1`,
        [memberId],
      ),
    );
    expect(due.rows[0]?.total_savings).toBe("500000.00");
  });

  it("rolls Target savings' earnings in with the capital, for the Receipts Confirmation Accountant to post", async () => {
    const plan = await maturedPlan("target", 6, 300000);
    const r = await ask(plan, 6, true);
    const done = await approve(r.id);
    // Target is 1% a month here: 6 months on 300,000.
    expect(done.earnings).toBe("18000.00");
    expect(await savings(done.new_plan_id!)).toBe("318000.00");
    const lines = await db.query<{
      account_code: string;
      debit: string;
      credit: string;
    }>(
      `select l.account_code, l.debit, l.credit from journal_lines l join plan_rollovers r on r.journal_entry_id = l.entry_id
       where r.id = $1 order by l.line_no`,
      [r.id],
    );
    expect(lines.rows).toEqual([
      { account_code: "2140", debit: "18000.00", credit: "0.00" },
      { account_code: "2110", debit: "0.00", credit: "18000.00" },
    ]);
    const entry = (
      await db.query<{ id: string; status: string }>(
        "select e.id, e.status from journal_entries e join plan_rollovers r on r.journal_entry_id = e.id where r.id = $1",
        [r.id],
      )
    ).rows[0];
    expect(entry.status).toBe("draft");
    await expect(
      commitAs(ACCOUNTANT, () =>
        db.query("select post_journal_entry($1)", [entry.id]),
      ),
    ).rejects.toThrow();
    const posted = await commitAs(CONFIRMER, () =>
      db.query<{ status: string }>(
        "select status from post_journal_entry($1)",
        [entry.id],
      ),
    );
    expect(posted.rows[0].status).toBe("posted");
  });

  it("pays Target earnings out through Accounts when only the capital rolls over", async () => {
    const plan = await maturedPlan("target", 3, 300000);
    await expect(ask(plan, 5)).rejects.toThrow(/runs for 3, 6, 12 months/);
    const r = await ask(plan, 3, false);
    const done = await approve(r.id);
    expect(done.earnings).toBe("9000.00");
    expect(await savings(done.new_plan_id!)).toBe("300000.00");
    const txn = await db.query<{
      id: string;
      transaction_type: string;
      amount: string;
      status: string;
      created_by: string | null;
    }>(
      "select f.id, f.transaction_type, f.amount, f.status, f.created_by from finance_transactions f join plan_rollovers r on r.payout_txn_id = f.id where r.id = $1",
      [r.id],
    );
    expect(txn.rows[0]).toMatchObject({
      transaction_type: "roi_payment",
      amount: "9000.00",
      status: "draft",
      created_by: null,
    });
    // Accounts submits it without an attachment, as with the automatic interest requests.
    const submitted = await commitAs(ACCOUNTANT, () =>
      db.query<{ status: string }>(
        "select status from submit_finance_transaction($1)",
        [txn.rows[0].id],
      ),
    );
    expect(submitted.rows[0].status).toBe("submitted");
  });

  it("waits for maturity, needs a different approver, and can be declined or cancelled", async () => {
    const early = await maturedPlan("gold", 12, 100000, -20);
    await expect(ask(early, 12)).rejects.toThrow(/matures on/);

    const plan = await maturedPlan("gold", 12, 100000);
    await db.query(
      "insert into staff_roles (staff_id, role_code, branch_id) values ($1, 'branch_manager', $2)",
      [OFFICER, lagos],
    );
    try {
      const r = await ask(plan, 12);
      await expect(
        commitAs(OFFICER, () =>
          db.query("select decide_plan_rollover($1, true, null)", [r.id]),
        ),
      ).rejects.toThrow(/someone other than the officer/);
      await expect(ask(plan, 12)).rejects.toThrow(/already waiting/);
      await expect(
        commitAs(MANAGER, () =>
          db.query("select decide_plan_rollover($1, false, 'no')", [r.id]),
        ),
      ).rejects.toThrow(/reason/);
      const declined = await commitAs(MANAGER, () =>
        db.query<Rollover>(
          "select * from decide_plan_rollover($1, false, 'Member wants to liquidate instead')",
          [r.id],
        ),
      );
      expect(declined.rows[0].status).toBe("declined");
      const again = await ask(plan, 12);
      const cancelled = await commitAs(OFFICER, () =>
        db.query<Rollover>(
          "select * from cancel_plan_rollover($1, 'Raised by mistake')",
          [again.id],
        ),
      );
      expect(cancelled.rows[0].status).toBe("cancelled");
      expect(await savings(plan)).toBe("100000.00");
    } finally {
      await db.query(
        "delete from staff_roles where staff_id = $1 and role_code = 'branch_manager'",
        [OFFICER],
      );
    }
  });
});
