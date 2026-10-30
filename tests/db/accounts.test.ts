import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const OFFICER = "00000000-0000-0000-0000-0000000000a1";
const MARKETER = "00000000-0000-0000-0000-0000000000e9";
const MANAGER = "00000000-0000-0000-0000-0000000000b1";
const LAGOS_ACCOUNTANT = "00000000-0000-0000-0000-0000000000e1";
const LAGOS_ACCOUNTANT_2 = "00000000-0000-0000-0000-0000000000e2";
const ABUJA_RECEIPTS = "00000000-0000-0000-0000-0000000000e3";
const CONTROLLER = "00000000-0000-0000-0000-0000000000f1";
const AUDITOR = "00000000-0000-0000-0000-0000000000d1";
const HEAD_OPS = "00000000-0000-0000-0000-0000000000c1";

let db: PGlite;
let lagos: string;
let abuja: string;
let lagosBank: string;
let abujaBank: string;
let memberId: string;
let ninCounter = 30000000000;
let refCounter = 1;

async function addStaff(id: string, department: string, role: string, branchId: string | null) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
  await db.query("insert into staff (id, full_name, email, department_code) values ($1::uuid, $1::text, $2, $3)", [
    id,
    `${id}@kuun.test`,
    department,
  ]);
  await db.query("insert into staff_roles (staff_id, role_code, branch_id) values ($1, $2, $3)", [id, role, branchId]);
}

/** Runs as the given staff member and commits, so later steps see the result. */
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

async function approvedMember(): Promise<string> {
  const nin = String(ninCounter++);
  const id = (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
         values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', $2, 'national_id', 'A123') returning id`,
        [lagos, nin],
      ),
    )
  ).rows[0].id;
  for (const t of ["kyc_form", "nin_slip", "means_of_id", "utility_bill"]) {
    await commitAs(OFFICER, () =>
      db.query(
        `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
         values ($1, $2, $3, 'f.pdf', $4, 'application/pdf', 1000)`,
        [id, lagos, t, `${lagos}/${id}/${t}-${Math.random()}.pdf`],
      ),
    );
  }
  await commitAs(OFFICER, () => db.query("select send_member_to_marketer($1)", [id]));
  await commitAs(MARKETER, () => db.query("select marketer_review_member($1, null)", [id]));
  await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
  await commitAs(MANAGER, () => db.query("select approve_member($1, $2)", [id, SIG]));
  return id;
}

type Txn = { id: string; status: string; branch_id: string; journal_entry_id: string | null };

async function draft(
  by: string,
  fields: { direction: "receipt" | "payment"; type: string; amount: number; bank?: string; member?: string | null; interest?: number },
): Promise<Txn> {
  const res = await commitAs(by, () =>
    db.query<Txn>(
      `insert into finance_transactions (direction, transaction_type, txn_date, amount, interest_amount, bank_account_id, member_id,
         reference, description, branch_id)
       values ($1, $2, current_date, $3, $4, $5, $6, $7, 'Test', $8) returning id, status, branch_id, journal_entry_id`,
      [
        fields.direction,
        fields.type,
        fields.amount,
        fields.interest ?? 0,
        fields.bank ?? lagosBank,
        fields.member ?? null,
        `REF-${refCounter++}`,
        lagos,
      ],
    ),
  );
  return res.rows[0];
}

async function attach(by: string, txn: Txn, kind = "supporting") {
  await commitAs(by, () =>
    db.query(
      `insert into finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
       values ($1, $2, $3, 'e.pdf', $4, 'application/pdf', 100)`,
      [txn.id, txn.branch_id, kind, `${txn.branch_id}/${txn.id}/${Math.random()}.pdf`],
    ),
  );
}

async function journalLines(entryId: string) {
  return (
    await db.query<{ account_code: string; debit: string; credit: string }>(
      "select account_code, debit, credit from journal_lines where entry_id = $1 order by line_no",
      [entryId],
    )
  ).rows;
}

async function txnRow(id: string) {
  return (await db.query<Txn>("select id, status, branch_id, journal_entry_id from finance_transactions where id = $1", [id])).rows[0];
}

async function newPlan(member = memberId, planType = "gold"): Promise<string> {
  const res = await commitAs(OFFICER, () =>
    db.query<{ id: string }>(
      `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
       values ($1, $2, $3, 5000, 'monthly', current_date - 60, current_date + 365) returning id`,
      [member, lagos, planType],
    ),
  );
  return res.rows[0].id;
}

async function setPlan(txnId: string, planId: string) {
  await commitAs(LAGOS_ACCOUNTANT, () => db.query("update finance_transactions set member_plan_id = $2 where id = $1", [txnId, planId]));
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
  await addStaff(LAGOS_ACCOUNTANT, "accounts", "regional_accountant", lagos);
  await addStaff(LAGOS_ACCOUNTANT_2, "accounts", "regional_accountant", lagos);
  await addStaff(ABUJA_RECEIPTS, "accounts", "receipts_accountant", abuja);
  await addStaff(CONTROLLER, "accounts", "financial_controller", null);
  await addStaff(AUDITOR, "internal_audit", "internal_auditor", null);
  await addStaff(HEAD_OPS, "administration", "head_of_administration", null);

  await db.exec(`
    insert into ledger_accounts (code, name, account_type, parent_code, cash_flow_class) values
      ('1131', 'Lagos bank', 'asset', '1130', 'cash'), ('1132', 'Abuja bank', 'asset', '1130', 'cash');
  `);
  lagosBank = (
    await db.query<{ id: string }>(
      "insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Lagos', '1131') returning id",
      [lagos],
    )
  ).rows[0].id;
  abujaBank = (
    await db.query<{ id: string }>(
      "insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Abuja', '1132') returning id",
      [abuja],
    )
  ).rows[0].id;
  memberId = await approvedMember();
});

describe("receipts", () => {
  it("needs evidence, a plan and Operations' check, then posts a balanced journal to the member's savings when someone else approves", async () => {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "receipt", type: "member_savings", amount: 50000, member: memberId });
    expect(txn.status).toBe("draft");

    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]))).rejects.toThrow(
      /supporting evidence/,
    );
    await attach(LAGOS_ACCOUNTANT, txn);
    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]))).rejects.toThrow(
      /choose the savings plan/,
    );
    await setPlan(txn.id, await newPlan());
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await expect(commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]))).rejects.toThrow(
      /Operations has to confirm/,
    );
    await commitAs(OFFICER, () => db.query("select confirm_member_receipt($1, 'Matches the passbook')", [txn.id]));

    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select approve_finance_transaction($1)", [txn.id]))).rejects.toThrow(
      /someone else must approve/,
    );
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]));

    const posted = await txnRow(txn.id);
    expect(posted.status).toBe("posted");
    expect(await journalLines(posted.journal_entry_id!)).toEqual([
      { account_code: "1131", debit: "50000.00", credit: "0.00" },
      { account_code: "2110", debit: "0.00", credit: "50000.00" },
    ]);
    const balance = await asUser(db, CONTROLLER, (tx) =>
      tx.query<{ savings: string }>("select savings from member_balances(current_date) where member_id = $1", [memberId]),
    );
    expect(balance.rows[0].savings).toBe("50000.00");
  });

  it("takes loan repayments only against a loan from the Credit department", async () => {
    await expect(
      draft(LAGOS_ACCOUNTANT, { direction: "receipt", type: "loan_repayment", amount: 11000, member: memberId }),
    ).rejects.toThrow(/choose the loan this repayment is for/);
  });

  it("requires a member for member savings", async () => {
    await expect(draft(LAGOS_ACCOUNTANT, { direction: "receipt", type: "member_savings", amount: 10 })).rejects.toThrow(/choose the member/);
  });

  it("refuses a reference already used on the same bank account", async () => {
    await commitAs(LAGOS_ACCOUNTANT, () =>
      db.query(
        `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, reference, description, branch_id)
         values ('receipt', 'fee_income', current_date, 10, $1, 'DUP-1', 'x', $2)`,
        [lagosBank, lagos],
      ),
    );
    await expect(
      commitAs(LAGOS_ACCOUNTANT, () =>
        db.query(
          `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, reference, description, branch_id)
           values ('receipt', 'fee_income', current_date, 10, $1, 'dup-1', 'x', $2)`,
          [lagosBank, lagos],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("keeps branches apart: an Abuja accountant can't record or see Lagos receipts", async () => {
    await expect(draft(ABUJA_RECEIPTS, { direction: "receipt", type: "fee_income", amount: 10, bank: lagosBank })).rejects.toThrow(
      /row-level security/,
    );
    const rows = await asUser(db, ABUJA_RECEIPTS, (tx) => tx.query("select id from finance_transactions where branch_id = $1", [lagos]));
    expect(rows.rows).toHaveLength(0);
    const own = await draft(ABUJA_RECEIPTS, { direction: "receipt", type: "fee_income", amount: 10, bank: abujaBank });
    expect(own.branch_id).toBe(abuja);
  });

  it("only takes verified Administration contributions, for the same amount and member", async () => {
    const plan = await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
         values ($1, $2, 'gold', 5000, 'monthly', current_date, current_date + 365) returning id`,
        [memberId, lagos],
      ),
    );
    const contribution = await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method)
         values ($1, $2, $3, 'scheduled', 5000, current_date, 'cash') returning id`,
        [plan.rows[0].id, memberId, lagos],
      ),
    );
    const insert = () =>
      commitAs(LAGOS_ACCOUNTANT, () =>
        db.query(
          `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, member_id, description,
             contribution_id, branch_id)
           values ('receipt', 'member_savings', current_date, 5000, $1, $2, 'Contribution', $3, $4)`,
          [lagosBank, memberId, contribution.rows[0].id, lagos],
        ),
      );
    await expect(insert()).rejects.toThrow(/verified by Administration/);
    await commitAs(MANAGER, () => db.query("select verify_contribution($1)", [contribution.rows[0].id]));
    const before = await asUser(db, LAGOS_ACCOUNTANT, (tx) => tx.query("select id from contributions_awaiting_posting"));
    expect(before.rows).toHaveLength(1);
    await insert();
    const after = await asUser(db, LAGOS_ACCOUNTANT, (tx) => tx.query("select id from contributions_awaiting_posting"));
    expect(after.rows).toHaveLength(0);
  });
});

describe("payments", () => {
  it("wait for Internal Audit after Accounts approves them, and audit can send them back", async () => {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "payment", type: "admin_expense", amount: 900 });
    await attach(LAGOS_ACCOUNTANT, txn);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await expect(commitAs(AUDITOR, () => db.query("select audit_approve_payment($1)", [txn.id]))).rejects.toThrow(/Accounts has approved/);
    await commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select approve_finance_transaction($1)", [txn.id]));
    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select audit_approve_payment($1)", [txn.id]))).rejects.toThrow(/not found/);
    const forged = await commitAs(LAGOS_ACCOUNTANT, () => db.query("update finance_transactions set audited_at = now() where id = $1", [txn.id]));
    expect(forged.affectedRows).toBe(0);
    await expect(commitAs(AUDITOR, () => db.query("select audit_decline_payment($1, 'returned', '')", [txn.id]))).rejects.toThrow(/reason/);
    await commitAs(AUDITOR, () => db.query("select audit_decline_payment($1, 'returned', 'Invoice is not addressed to Kuun')", [txn.id]));
    const row = await db.query("select status, decision_reason from finance_transactions where id = $1", [txn.id]);
    expect(row.rows[0]).toEqual({ status: "returned", decision_reason: "Internal Audit: Invoice is not addressed to Kuun" });

    // Resubmitted and approved again, it goes back to Internal Audit.
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select approve_finance_transaction($1)", [txn.id]));
    const approved = await commitAs(AUDITOR, () =>
      db.query<{ audited_by: string }>("select audited_by from audit_approve_payment($1)", [txn.id]),
    );
    expect(approved.rows[0].audited_by).toBe(AUDITOR);
    await expect(commitAs(AUDITOR, () => db.query("select audit_approve_payment($1)", [txn.id]))).rejects.toThrow(/hasn't yet/);
  });

  it("can't be paid by the approver or without proof, and posts expense against the bank once paid", async () => {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "payment", type: "admin_expense", amount: 2500 });
    await attach(LAGOS_ACCOUNTANT, txn);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select approve_finance_transaction($1)", [txn.id]));
    expect((await txnRow(txn.id)).status).toBe("approved");

    await attach(LAGOS_ACCOUNTANT, txn, "payment_proof");
    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select pay_finance_transaction($1)", [txn.id]))).rejects.toThrow(
      /Internal Audit has to approve/,
    );
    await commitAs(AUDITOR, () => db.query("select audit_approve_payment($1)", [txn.id]));
    await expect(commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select pay_finance_transaction($1)", [txn.id]))).rejects.toThrow(
      /you approved this payment/,
    );
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select pay_finance_transaction($1)", [txn.id]));
    expect(await journalLines((await txnRow(txn.id)).journal_entry_id!)).toEqual([
      { account_code: "5300", debit: "2500.00", credit: "0.00" },
      { account_code: "1131", debit: "0.00", credit: "2500.00" },
    ]);
  });

  it("can be returned with a reason and edited again by its owner only", async () => {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "payment", type: "other_expense", amount: 100 });
    await attach(LAGOS_ACCOUNTANT, txn);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    const whileSubmitted = await asUser(db, LAGOS_ACCOUNTANT, (tx) =>
      tx.query("update finance_transactions set amount = 1 where id = $1", [txn.id]),
    );
    expect(whileSubmitted.affectedRows).toBe(0);
    await commitAs(CONTROLLER, () => db.query("select decline_finance_transaction($1, 'returned', 'Wrong amount')", [txn.id]));
    const other = await asUser(db, LAGOS_ACCOUNTANT_2, (tx) =>
      tx.query("update finance_transactions set amount = 90 where id = $1", [txn.id]),
    );
    expect(other.affectedRows).toBe(0);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("update finance_transactions set amount = 90 where id = $1", [txn.id]));
    await expect(
      commitAs(LAGOS_ACCOUNTANT, () => db.query("update finance_transactions set status = 'posted' where id = $1", [txn.id])),
    ).rejects.toThrow(/approval workflow/);
  });
});

describe("journals", () => {
  async function manualEntry(lines: [string, number, number][], by = LAGOS_ACCOUNTANT): Promise<string> {
    const entry = await commitAs(by, () =>
      db.query<{ id: string }>(
        "insert into journal_entries (branch_id, entry_date, description) values ($1, current_date, 'Manual') returning id",
        [lagos],
      ),
    );
    const id = entry.rows[0].id;
    for (const [i, [account, debit, credit]] of lines.entries()) {
      await commitAs(by, () =>
        db.query("insert into journal_lines (entry_id, line_no, branch_id, account_code, debit, credit) values ($1, $2, $3, $4, $5, $6)", [
          id,
          i,
          lagos,
          account,
          debit,
          credit,
        ]),
      );
    }
    return id;
  }

  it("won't post an unbalanced entry, or let the preparer post their own", async () => {
    const unbalanced = await manualEntry([
      ["5800", 100, 0],
      ["1131", 0, 90],
    ]);
    await expect(commitAs(CONTROLLER, () => db.query("select post_journal_entry($1)", [unbalanced]))).rejects.toThrow(/must equal credits/);

    const balanced = await manualEntry([
      ["5800", 100, 0],
      ["1131", 0, 100],
    ]);
    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select post_journal_entry($1)", [balanced]))).rejects.toThrow();
    await commitAs(CONTROLLER, () => db.query("select post_journal_entry($1)", [balanced]));
  });

  it("refuses postings to group headings", async () => {
    await expect(manualEntry([["1100", 100, 0]])).rejects.toThrow(/group heading/);
  });

  it("locks posted entries and corrects them by reversal, marking the transaction reversed", async () => {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "receipt", type: "other_income", amount: 700 });
    await attach(LAGOS_ACCOUNTANT, txn);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]));
    const entryId = (await txnRow(txn.id)).journal_entry_id!;

    const deleted = await asUser(db, CONTROLLER, (tx) => tx.query("delete from journal_entries where id = $1", [entryId]));
    expect(deleted.affectedRows).toBe(0);
    await expect(db.query("delete from journal_entries where id = $1", [entryId])).rejects.toThrow(/never deleted/);
    const lineUpdate = await asUser(db, CONTROLLER, (tx) => tx.query("update journal_lines set debit = 1 where entry_id = $1", [entryId]));
    expect(lineUpdate.affectedRows).toBe(0);

    await commitAs(CONTROLLER, () => db.query("select reverse_journal_entry($1, 'Posted to the wrong account')", [entryId]));
    expect((await txnRow(txn.id)).status).toBe("reversed");
    const net = await db.query<{ net: string }>(
      `select sum(l.debit - l.credit)::text as net from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.id = $1 or e.reverses_entry_id = $1 group by l.account_code limit 1`,
      [entryId],
    );
    expect(Number(net.rows[0].net)).toBe(0);
    await expect(commitAs(CONTROLLER, () => db.query("select reverse_journal_entry($1, 'again')", [entryId]))).rejects.toThrow(
      /already been reversed/,
    );
  });

  it("keeps the trial balance balanced", async () => {
    const tb = await asUser(db, CONTROLLER, (tx) =>
      tx.query<{ debit: string; credit: string }>("select sum(debit)::text as debit, sum(credit)::text as credit from account_balances('2000-01-01', current_date)"),
    );
    expect(tb.rows[0].debit).toBe(tb.rows[0].credit);
  });
});

describe("bank reconciliation", () => {
  it("imports a statement once, skips duplicate lines, auto-matches safe pairs and reconciles to zero", async () => {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "receipt", type: "fee_income", amount: 4321 });
    await attach(LAGOS_ACCOUNTANT, txn);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]));

    const lines = JSON.stringify([
      { date: new Date().toISOString().slice(0, 10), description: "FEE RECEIVED", reference: "X1", amount: 4321, balance: 4321 },
      { date: new Date().toISOString().slice(0, 10), description: "SMS ALERT CHARGES", reference: null, amount: -50, balance: 4271 },
    ]);
    const imported = await commitAs(LAGOS_ACCOUNTANT, () =>
      db.query<{ line_count: number }>("select * from import_bank_statement($1, 's.csv', null, 'sha-1', $2::jsonb)", [lagosBank, lines]),
    );
    expect(imported.rows[0].line_count).toBe(2);

    await expect(
      commitAs(LAGOS_ACCOUNTANT, () => db.query("select import_bank_statement($1, 's.csv', null, 'sha-1', $2::jsonb)", [lagosBank, lines])),
    ).rejects.toThrow(/already been imported/);
    const again = await commitAs(LAGOS_ACCOUNTANT, () =>
      db.query<{ line_count: number; duplicate_count: number }>(
        "select * from import_bank_statement($1, 's2.csv', null, 'sha-2', $2::jsonb)",
        [lagosBank, lines],
      ),
    );
    expect(again.rows[0]).toMatchObject({ line_count: 0, duplicate_count: 2 });

    const charge = await db.query<{ suggested_type: string }>("select suggested_type from bank_statement_lines where amount = -50");
    expect(charge.rows[0].suggested_type).toBe("bank_charges");

    const matched = await commitAs(LAGOS_ACCOUNTANT, () => db.query<{ n: number }>("select auto_match_bank_lines($1) as n", [lagosBank]));
    expect(matched.rows[0].n).toBe(1);

    // The bank charge isn't in the books yet: posting it from the statement line matches it automatically.
    const chargeLine = await db.query<{ id: string }>("select id from bank_statement_lines where amount = -50");
    const fee = await commitAs(LAGOS_ACCOUNTANT, () =>
      db.query<{ id: string }>(
        `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, description, statement_line_id, branch_id)
         values ('payment', 'bank_charges', current_date, 50, $1, 'SMS alerts', $2, $3) returning id`,
        [lagosBank, chargeLine.rows[0].id, lagos],
      ),
    );
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [fee.rows[0].id]));
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [fee.rows[0].id]));
    await commitAs(AUDITOR, () => db.query("select audit_approve_payment($1)", [fee.rows[0].id]));
    await attach(LAGOS_ACCOUNTANT_2, { ...(await txnRow(fee.rows[0].id)) }, "payment_proof");
    await commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select pay_finance_transaction($1)", [fee.rows[0].id]));
    const line = await db.query<{ status: string }>("select status from bank_statement_lines where id = $1", [chargeLine.rows[0].id]);
    expect(line.rows[0].status).toBe("matched");
  });

  it("won't complete a reconciliation with an unexplained difference, or by its preparer", async () => {
    const rec = await commitAs(LAGOS_ACCOUNTANT, () =>
      db.query<{ id: string; difference: string }>(
        "select * from prepare_bank_reconciliation($1, current_date, 999999)",
        [lagosBank],
      ),
    );
    expect(Number(rec.rows[0].difference)).not.toBe(0);
    await expect(commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select complete_bank_reconciliation($1)", [rec.rows[0].id]))).rejects.toThrow(
      /document the reconciling items/,
    );
    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select complete_bank_reconciliation($1)", [rec.rows[0].id]))).rejects.toThrow(
      /someone else must review/,
    );
  });
});

describe("internal audit access", () => {
  it("lets the auditor read the books but not change them", async () => {
    const rows = await asUser(db, AUDITOR, (tx) => tx.query("select id from finance_transactions"));
    expect(rows.rows.length).toBeGreaterThan(0);
    await expect(draft(AUDITOR, { direction: "receipt", type: "fee_income", amount: 1 })).rejects.toThrow(/row-level security/);
    const rule = await asUser(db, AUDITOR, (tx) => tx.query("update posting_rules set credit_account = '4400' where transaction_type = 'fee_income'"));
    expect(rule.affectedRows).toBe(0);
  });

  it("flags incomplete KYC and reversals as exceptions for the auditor", async () => {
    await commitAs(OFFICER, () =>
      db.query(
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number, created_at)
         values ($1, 'No', 'Docs', '08030000000', 'Ikeja', $2, 'national_id', 'Z1', now() - interval '30 days')`,
        [lagos, String(ninCounter++)],
      ),
    );
    const found = await asUser(db, AUDITOR, (tx) => tx.query<{ category: string }>("select distinct category from audit_exceptions()"));
    const categories = found.rows.map((r) => r.category);
    expect(categories).toContain("incomplete_kyc");
    expect(categories).toContain("adjustment");
  });

  it("summarises branch activity and the customer register within the caller's branches", async () => {
    const ops = await asUser(db, AUDITOR, (tx) =>
      tx.query<{ receipts_total: string }>(
        "select sum(receipts_total) as receipts_total from branch_operations(current_date - 30, current_date, 'month') where branch_id = $1",
        [lagos],
      ),
    );
    expect(Number(ops.rows[0].receipts_total)).toBeGreaterThan(0);
    const register = await asUser(db, AUDITOR, (tx) => tx.query("select member_id from customer_register()"));
    expect(register.rows.length).toBeGreaterThan(1);
    const abujaView = await asUser(db, ABUJA_RECEIPTS, (tx) => tx.query("select member_id from customer_register()"));
    expect(abujaView.rows).toHaveLength(0);
  });
});

describe("Operations confirms member receipts", () => {
  async function submittedSavings(amount = 7000) {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "receipt", type: "member_savings", amount, member: memberId });
    await attach(LAGOS_ACCOUNTANT, txn);
    await setPlan(txn.id, await newPlan());
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    return txn;
  }

  it("queues the receipt for Operations in its branch only, and only Operations can confirm it", async () => {
    const txn = await submittedSavings();
    const queue = await asUser(db, OFFICER, (tx) =>
      tx.query<{ id: string; member_name: string; plan_name: string; bank_account_name: string }>("select * from receipts_to_confirm()"),
    );
    const row = queue.rows.find((r) => r.id === txn.id);
    expect(row).toMatchObject({ member_name: "Ada Obi", plan_name: "Gold", bank_account_name: "Lagos" });
    for (const outsider of [LAGOS_ACCOUNTANT_2, ABUJA_RECEIPTS]) {
      const none = await asUser(db, outsider, (tx) => tx.query("select id from receipts_to_confirm()"));
      expect(none.rows).toHaveLength(0);
    }
    await expect(commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select confirm_member_receipt($1, null)", [txn.id]))).rejects.toThrow(
      /receipt not found/,
    );
    await commitAs(MANAGER, () => db.query("select confirm_member_receipt($1, null)", [txn.id]));
    await expect(commitAs(OFFICER, () => db.query("select confirm_member_receipt($1, null)", [txn.id]))).rejects.toThrow(
      /waiting for Operations/,
    );
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]));
    expect((await txnRow(txn.id)).status).toBe("posted");
  });

  it("sends a mismatch back to Accounts, and a resubmitted receipt needs a fresh confirmation", async () => {
    const txn = await submittedSavings();
    await expect(commitAs(OFFICER, () => db.query("select return_member_receipt($1, 'no')", [txn.id]))).rejects.toThrow(/doesn't match/);
    await commitAs(OFFICER, () => db.query("select return_member_receipt($1, 'Client paid 5,000 not 7,000')", [txn.id]));
    const back = await db.query<{ status: string; decision_reason: string }>("select status, decision_reason from finance_transactions where id = $1", [txn.id]);
    expect(back.rows[0]).toEqual({ status: "returned", decision_reason: "Operations: Client paid 5,000 not 7,000" });

    await commitAs(LAGOS_ACCOUNTANT, () => db.query("update finance_transactions set amount = 5000 where id = $1", [txn.id]));
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await expect(commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]))).rejects.toThrow(
      /Operations has to confirm/,
    );
  });

  it("can't be forged, and the plan must be the member's", async () => {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "receipt", type: "member_savings", amount: 100, member: memberId });
    await expect(
      commitAs(LAGOS_ACCOUNTANT, () => db.query("update finance_transactions set ops_confirmed_at = now() where id = $1", [txn.id])),
    ).rejects.toThrow(/only through the receipt workflow/);
    const otherPlan = await newPlan(await approvedMember());
    await expect(setPlan(txn.id, otherPlan)).rejects.toThrow(/must belong to the member/);
  });

  it("isn't needed for receipts that aren't member money", async () => {
    const txn = await draft(LAGOS_ACCOUNTANT, { direction: "receipt", type: "fee_income", amount: 300 });
    await attach(LAGOS_ACCOUNTANT, txn);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]));
    expect((await txnRow(txn.id)).status).toBe("posted");
  });
});

describe("monthly interest payment schedule", () => {
  let payee: string;

  beforeAll(async () => {
    payee = await approvedMember();
    const today = new Date().getDate();
    await commitAs(HEAD_OPS, () =>
      db.query(
        `update members set bank_code = '058', bank_name = 'whatever', bank_account_no = '0123456789', interest_pay_day = $2,
           amendment_reason = 'Bank details from the client' where id = $1`,
        [payee, today],
      ),
    );
    const plan = await newPlan(payee, "gold");
    const c = await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method)
         values ($1, $2, $3, 'scheduled', 120000, current_date - 30, 'bank_transfer') returning id`,
        [plan, payee, lagos],
      ),
    );
    await commitAs(MANAGER, () => db.query("select verify_contribution($1)", [c.rows[0].id]));
  });

  it("takes the bank name from the CBN code list and checks the account number", async () => {
    const m = await db.query<{ bank_name: string }>("select bank_name from members where id = $1", [payee]);
    expect(m.rows[0].bank_name).toBe("GTBank");
    await expect(
      commitAs(HEAD_OPS, () =>
        db.query("update members set bank_account_no = '12345', amendment_reason = 'Typo fix here' where id = $1", [payee]),
      ),
    ).rejects.toThrow(/bank_account_no/);
  });

  it("opens plans at the plan type's rate, whatever the officer sends", async () => {
    const res = await commitAs(OFFICER, () =>
      db.query<{ interest_rate: string }>(
        `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date,
           interest_rate) values ($1, $2, 'silver', 1000, 'monthly', current_date, current_date + 30, 99) returning interest_rate`,
        [payee, lagos],
      ),
    );
    expect(res.rows[0].interest_rate).toBe("10.00");
  });

  it("lists members due today with savings, rate and a month's interest", async () => {
    const res = await asUser(db, LAGOS_ACCOUNTANT, (tx) =>
      tx.query("select * from interest_payment_schedule(current_date) where member_id = $1", [payee]),
    );
    expect(res.rows[0]).toMatchObject({
      beneficiary_name: "Ada Obi",
      bank_name: "GTBank",
      bank_code: "058",
      bank_account_no: "0123456789",
      branch_name: "Lagos",
      total_savings: "120000.00",
      interest_rate: "12.00",
      amount: "1200.00",
    });
    const tomorrow = await asUser(db, LAGOS_ACCOUNTANT, (tx) =>
      tx.query("select * from interest_payment_schedule(current_date + 1) where member_id = $1", [payee]),
    );
    expect(tomorrow.rows).toHaveLength(0);
  });

  it("pays days past the month's end on its last day", async () => {
    await commitAs(HEAD_OPS, () =>
      db.query("update members set interest_pay_day = 31, amendment_reason = 'Client asked for month end' where id = $1", [payee]),
    );
    const res = await asUser(db, LAGOS_ACCOUNTANT, (tx) =>
      tx.query(
        `select * from interest_payment_schedule((date_trunc('month', current_date) + interval '1 month - 1 day')::date)
         where member_id = $1`,
        [payee],
      ),
    );
    expect(res.rows).toHaveLength(1);
  });
});
