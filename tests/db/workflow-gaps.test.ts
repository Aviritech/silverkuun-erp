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
const HEAD = "00000000-0000-0000-0000-0000000000c1";

let db: PGlite;
let lagos: string;
let abuja: string;
let lagosBank: string;
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
  await addStaff(HEAD, "administration", "head_of_administration", null);

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
  memberId = await approvedMember();
});


async function plan(memberId: string, startMonthsAgo: number, amount = 1000): Promise<string> {
  const res = await commitAs(OFFICER, () =>
    db.query<{ id: string }>(
      `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
       values ($1, $2, 'gold', $3, 'monthly', current_date - make_interval(months => $4), current_date + interval '20 days')
       returning id`,
      [memberId, lagos, amount, startMonthsAgo],
    ),
  );
  return res.rows[0].id;
}

async function contribute(planId: string, kind: "scheduled" | "top_up", amount: number) {
  return (
    await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method)
         select id, member_id, branch_id, $2, $3, current_date, 'bank_transfer' from member_plans where id = $1 returning id`,
        [planId, kind, amount],
      ),
    )
  ).rows[0].id;
}

describe("administration gaps", () => {
  it("shows what each plan should have received, what was paid and what is outstanding", async () => {
    const planId = await plan(memberId, 3);
    const first = await contribute(planId, "scheduled", 1000);
    await contribute(planId, "top_up", 500);
    const progress = async () =>
      (
        await asUser(db, OFFICER, (tx) =>
          tx.query<Record<string, string | number>>(
            "select installments_due, expected_to_date, scheduled_paid, top_ups, total_contributed, outstanding, days_to_maturity from plan_progress where plan_id = $1",
            [planId],
          ),
        )
      ).rows[0];
    expect(await progress()).toMatchObject({
      installments_due: 4,
      expected_to_date: "4000.00",
      scheduled_paid: "1000.00",
      top_ups: "500.00",
      total_contributed: "1500.00",
      outstanding: "3000.00",
      days_to_maturity: 20,
    });
    // Reversing the scheduled payment puts it back into what is outstanding; top-ups never reduce it.
    await commitAs(OFFICER, () =>
      db.query(
        `insert into contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reverses_id, notes)
         values ($1, $2, $3, 'reversal', -1000, current_date, 'bank_transfer', $4, 'Bounced transfer')`,
        [planId, memberId, lagos, first],
      ),
    );
    expect(await progress()).toMatchObject({ scheduled_paid: "0.00", top_ups: "500.00", outstanding: "4000.00" });
  });

  it("records the Branch Manager's drawn signature on approval and nowhere else", async () => {
    const id = (
      await commitAs(OFFICER, () =>
        db.query<{ id: string }>(
          `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number, approval_signature)
           values ($1, 'Sig', 'Test', '08030000000', 'Lagos', $2, 'national_id', 'A1', $3) returning id, approval_signature`,
          [lagos, String(ninCounter++), SIG],
        ),
      )
    ).rows[0].id;
    expect((await db.query("select approval_signature from members where id = $1", [id])).rows[0]).toEqual({ approval_signature: null });
    for (const t of ["kyc_form", "nin_slip", "means_of_id", "utility_bill"]) {
      await commitAs(OFFICER, () =>
        db.query(
          `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
           values ($1, $2, $3, 'f.pdf', $4, 'application/pdf', 1000)`,
          [id, lagos, t, `${lagos}/${id}/${t}.pdf`],
        ),
      );
    }
    await commitAs(OFFICER, () => db.query("select send_member_to_marketer($1)", [id]));
    await commitAs(MARKETER, () => db.query("select marketer_review_member($1, null)", [id]));
    await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
    await expect(commitAs(MANAGER, () => db.query("select approve_member($1, '')", [id]))).rejects.toThrow(/sign in the box/);
    await expect(commitAs(MANAGER, () => db.query("select approve_member($1, 'javascript:alert(1)')", [id]))).rejects.toThrow(/sign in the box/);
    await commitAs(MANAGER, () => db.query("select approve_member($1, $2)", [id, SIG]));
    expect((await db.query("select approval_signature from members where id = $1", [id])).rows[0]).toEqual({ approval_signature: SIG });
    await expect(
      commitAs(HEAD, () => db.query("update members set approval_signature = null, amendment_reason = 'Clearing it' where id = $1", [id])),
    ).rejects.toThrow(/approval signature/);
  });

  it("records when a letter or statement was issued, once, by branch staff", async () => {
    const doc = async (type: string) =>
      (
        await commitAs(OFFICER, () =>
          db.query<{ id: string }>(
            `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
             values ($1, $2, $3, 'l.pdf', $4, 'application/pdf', 1000) returning id`,
            [memberId, lagos, type, `${lagos}/${memberId}/${type}-${Math.random()}.pdf`],
          ),
        )
      ).rows[0].id;
    const letter = await doc("maturity_letter");
    await expect(
      commitAs(OFFICER, () => db.query("select record_document_issue($1, current_date + 1, 'email')", [letter])),
    ).rejects.toThrow(/future/);
    await commitAs(OFFICER, () => db.query("select record_document_issue($1, current_date, 'in_person', 'Collected by member')", [letter]));
    const issued = await db.query("select issued_on is not null as issued, issued_by, issue_channel from member_documents where id = $1", [letter]);
    expect(issued.rows[0]).toEqual({ issued: true, issued_by: OFFICER, issue_channel: "in_person" });
    await expect(
      commitAs(OFFICER, () => db.query("select record_document_issue($1, current_date, 'email')", [letter])),
    ).rejects.toThrow(/already issued/);
    const kyc = await doc("other");
    await expect(commitAs(OFFICER, () => db.query("select record_document_issue($1, current_date, 'email')", [kyc]))).rejects.toThrow(
      /only agreement letters/,
    );
    const statement = await doc("statement_of_account");
    await expect(
      commitAs(LAGOS_ACCOUNTANT, () => db.query("select record_document_issue($1, current_date, 'email')", [statement])),
    ).rejects.toThrow(/not found/);
  });

  it("lets the Head of Administration set monthly branch targets, and only them", async () => {
    const month = new Date().toISOString().slice(0, 7) + "-01";
    await commitAs(HEAD, () =>
      db.query("insert into branch_targets (branch_id, month, registrations, collections) values ($1, $2, 10, 500000)", [lagos, month]),
    );
    await commitAs(HEAD, () =>
      db.query(
        `insert into branch_targets (branch_id, month, registrations, collections) values ($1, $2, 12, 600000)
         on conflict (branch_id, month) do update set registrations = excluded.registrations, collections = excluded.collections`,
        [lagos, month],
      ),
    );
    expect((await db.query("select registrations, set_by from branch_targets where branch_id = $1", [lagos])).rows[0]).toEqual({
      registrations: 12,
      set_by: HEAD,
    });
    await expect(
      commitAs(OFFICER, () => db.query("insert into branch_targets (branch_id, month, registrations) values ($1, $2, 1)", [abuja, month])),
    ).rejects.toThrow(/row-level security/);
    const read = await asUser(db, OFFICER, (tx) => tx.query("select * from branch_targets"));
    expect(read.rows).toHaveLength(1);
  });
});

describe("suppliers and bills", () => {
  let supplier: string;
  let bill: { id: string; branch_id: string };

  it("posts an approved bill to supplier payables, tagged with the supplier and department", async () => {
    supplier = (
      await commitAs(LAGOS_ACCOUNTANT, () => db.query<{ id: string }>("insert into suppliers (name) values ('Adewale & Co') returning id"))
    ).rows[0].id;
    await expect(
      commitAs(LAGOS_ACCOUNTANT, () => db.query("insert into suppliers (name) values ('  adewale & co ')")),
    ).rejects.toThrow(/duplicate/);
    await expect(commitAs(OFFICER, () => db.query("insert into suppliers (name) values ('Someone')"))).rejects.toThrow(
      /row-level security/,
    );

    bill = (
      await commitAs(LAGOS_ACCOUNTANT, () =>
        db.query<{ id: string; branch_id: string }>(
          `insert into supplier_bills (bill_no, supplier_id, branch_id, department_code, bill_date, due_date, supplier_reference,
             expense_account, amount, description)
           values ('x', $1, $2, 'administration', current_date, current_date + 30, 'INV-77', '5300', 120000, 'Office rent')
           returning id, branch_id, bill_no`,
          [supplier, lagos],
        ),
      )
    ).rows[0];
    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_supplier_bill($1)", [bill.id]))).rejects.toThrow(
      /invoice first/,
    );
    await commitAs(LAGOS_ACCOUNTANT, () =>
      db.query(
        `insert into finance_attachments (supplier_bill_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
         values ($1, $2, 'supporting', 'inv.pdf', $3, 'application/pdf', 100)`,
        [bill.id, lagos, `${lagos}/bills/${bill.id}/inv.pdf`],
      ),
    );
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_supplier_bill($1)", [bill.id]));
    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select approve_supplier_bill($1)", [bill.id]))).rejects.toThrow(
      /someone else/,
    );
    await commitAs(CONTROLLER, () => db.query("select approve_supplier_bill($1)", [bill.id]));
    const posted = await db.query<{ status: string; journal_entry_id: string; bill_no: string }>(
      "select status, journal_entry_id, bill_no from supplier_bills where id = $1",
      [bill.id],
    );
    expect(posted.rows[0].status).toBe("posted");
    expect(posted.rows[0].bill_no).toMatch(/^BILL-\d{6}$/);
    const lines = await db.query(
      "select account_code, debit, credit, supplier_id, department_code from journal_lines where entry_id = $1 order by line_no",
      [posted.rows[0].journal_entry_id],
    );
    expect(lines.rows).toEqual([
      { account_code: "5300", debit: "120000.00", credit: "0.00", supplier_id: supplier, department_code: "administration" },
      { account_code: "2210", debit: "0.00", credit: "120000.00", supplier_id: supplier, department_code: "administration" },
    ]);
  });

  it("pays a bill no more than is owed, and shows it settled", async () => {
    const pay = (amount: number, fields: string, values: unknown[]) =>
      commitAs(LAGOS_ACCOUNTANT, () =>
        db.query<Txn>(
          `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, reference, description, branch_id ${fields})
           values ('payment', 'supplier_payment', current_date, $1, $2, $3, 'Rent', $4 ${values.map((_, i) => `, $${i + 5}`).join("")})
           returning id, status, branch_id, journal_entry_id`,
          [amount, lagosBank, `PAY-${refCounter++}`, lagos, ...values],
        ),
      );
    await expect(pay(100, "", [])).rejects.toThrow(/choose the supplier/);
    await expect(pay(130000, ", supplier_bill_id", [bill.id])).rejects.toThrow(/more than the 120000.00 still owed/);
    const txn = (await pay(120000, ", supplier_bill_id", [bill.id])).rows[0];
    const row = await db.query("select supplier_id, counterparty, department_code from finance_transactions where id = $1", [txn.id]);
    expect(row.rows[0]).toEqual({ supplier_id: supplier, counterparty: "Adewale & Co", department_code: "administration" });
    await expect(pay(1, ", supplier_bill_id", [bill.id])).rejects.toThrow(/still owed/);

    await attach(LAGOS_ACCOUNTANT, txn);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]));
    await commitAs(AUDITOR, () => db.query("select audit_approve_payment($1)", [txn.id]));
    await attach(LAGOS_ACCOUNTANT_2, txn, "payment_proof");
    await commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select pay_finance_transaction($1)", [txn.id]));
    const balance = await asUser(db, AUDITOR, (tx) => tx.query("select paid, outstanding from supplier_bill_balances where id = $1", [bill.id]));
    expect(balance.rows[0]).toEqual({ paid: "120000.00", outstanding: "0.00" });
    const ledger = await journalLines((await txnRow(txn.id)).journal_entry_id!);
    expect(ledger[0]).toEqual({ account_code: "2210", debit: "120000.00", credit: "0.00" });
  });
});

describe("reporting dimensions", () => {
  it("filters ledger balances by department and keeps foreign currency payments consistent", async () => {
    const txn = (
      await commitAs(LAGOS_ACCOUNTANT, () =>
        db.query<Txn>(
          `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, reference, description, branch_id,
             department_code, staff_id)
           values ('payment', 'admin_expense', current_date, 700, $1, 'DIM-1', 'Training', $2, 'accounts', $3)
           returning id, status, branch_id, journal_entry_id`,
          [lagosBank, lagos, LAGOS_ACCOUNTANT_2],
        ),
      )
    ).rows[0];
    await attach(LAGOS_ACCOUNTANT, txn);
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [txn.id]));
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [txn.id]));
    await commitAs(AUDITOR, () => db.query("select audit_approve_payment($1)", [txn.id]));
    await attach(LAGOS_ACCOUNTANT_2, txn, "payment_proof");
    await commitAs(LAGOS_ACCOUNTANT_2, () => db.query("select pay_finance_transaction($1)", [txn.id]));

    const tagged = await db.query("select department_code, staff_id from journal_lines where entry_id = $1 limit 1", [
      (await txnRow(txn.id)).journal_entry_id,
    ]);
    expect(tagged.rows[0]).toEqual({ department_code: "accounts", staff_id: LAGOS_ACCOUNTANT_2 });
    const balances = await asUser(db, CONTROLLER, (tx) =>
      tx.query<{ code: string; debit: string }>(
        "select code, debit from account_balances('2000-01-01', current_date, null, null, 'accounts', null) where debit <> 0",
      ),
    );
    expect(balances.rows).toEqual([{ code: "5300", debit: "700.00" }]);

    const usd = (fa: number | null, rate: number | null, amount: number) =>
      commitAs(LAGOS_ACCOUNTANT, () =>
        db.query(
          `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, reference, description, branch_id,
             currency, foreign_amount, fx_rate)
           values ('payment', 'admin_expense', current_date, $1, $2, $3, 'Software', $4, 'USD', $5, $6)`,
          [amount, lagosBank, `USD-${refCounter++}`, lagos, fa, rate],
        ),
      );
    await expect(usd(null, null, 1500)).rejects.toThrow(/USD amount and the exchange rate/);
    await expect(usd(10, 1500, 15001)).rejects.toThrow(/must equal/);
    await usd(10, 1500.5, 15005);
  });
});

describe("posting rule changes", () => {
  it("apply only after someone other than the proposer approves them", async () => {
    const direct = await asUser(db, CONTROLLER, (tx) =>
      tx.query("update posting_rules set debit_account = '5800' where transaction_type = 'admin_expense'"),
    );
    expect(direct.affectedRows).toBe(0);

    const change = (
      await commitAs(LAGOS_ACCOUNTANT, () =>
        db.query<{ id: string; credit_account: string | null }>(
          `insert into posting_rule_changes (transaction_type, debit_account, credit_account, requires_member, is_active, reason)
           values ('admin_expense', '5800', '1131', false, true, 'Use the general expenses account') returning id, credit_account`,
        ),
      )
    ).rows[0];
    expect(change.credit_account).toBeNull();
    await expect(
      commitAs(LAGOS_ACCOUNTANT, () =>
        db.query(
          "insert into posting_rule_changes (transaction_type, debit_account, requires_member, is_active, reason) values ('admin_expense', '5800', false, true, 'Again')",
        ),
      ),
    ).rejects.toThrow(/duplicate/);
    await expect(commitAs(LAGOS_ACCOUNTANT, () => db.query("select decide_posting_rule_change($1, true)", [change.id]))).rejects.toThrow(
      /not found/,
    );
    await expect(commitAs(CONTROLLER, () => db.query("select decide_posting_rule_change($1, false)", [change.id]))).rejects.toThrow(
      /say why/,
    );
    await commitAs(CONTROLLER, () => db.query("select decide_posting_rule_change($1, true)", [change.id]));
    expect((await db.query("select debit_account from posting_rules where transaction_type = 'admin_expense'")).rows[0]).toEqual({
      debit_account: "5800",
    });

    const own = (
      await commitAs(CONTROLLER, () =>
        db.query<{ id: string }>(
          `insert into posting_rule_changes (transaction_type, debit_account, requires_member, is_active, reason)
           values ('admin_expense', '5300', false, true, 'Back to admin costs') returning id`,
        ),
      )
    ).rows[0];
    await expect(commitAs(CONTROLLER, () => db.query("select decide_posting_rule_change($1, true)", [own.id]))).rejects.toThrow(
      /someone else/,
    );
  });
});

describe("bank suggestions", () => {
  it("learn from how earlier lines with the same description were posted", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const importLine = async (description: string, amount: number, sha: string) => {
      await commitAs(LAGOS_ACCOUNTANT, () =>
        db.query("select import_bank_statement($1, 'x.csv', null, $2, $3::jsonb)", [
          lagosBank,
          sha,
          JSON.stringify([{ date: today, description, reference: sha, amount, balance: null }]),
        ]),
      );
      return (
        await db.query<{ id: string; suggested_type: string | null; suggestion_confidence: string | null; suggestion_reason: string | null }>(
          "select id, suggested_type, suggestion_confidence, suggestion_reason from bank_statement_lines where reference = $1",
          [sha],
        )
      ).rows[0];
    };
    const first = await importLine("TRF FROM ACME LTD 0012/44", 2500, "learn-1");
    expect(first.suggested_type).toBeNull();

    const receipt = (
      await commitAs(LAGOS_ACCOUNTANT, () =>
        db.query<{ id: string }>(
          `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, description, statement_line_id, branch_id)
           values ('receipt', 'fee_income', current_date, 2500, $1, 'Acme fees', $2, $3) returning id`,
          [lagosBank, first.id, lagos],
        ),
      )
    ).rows[0];
    await commitAs(LAGOS_ACCOUNTANT, () => db.query("select submit_finance_transaction($1)", [receipt.id]));
    await commitAs(CONTROLLER, () => db.query("select approve_finance_transaction($1)", [receipt.id]));

    const second = await importLine("TRF FROM ACME LTD 0013/45", 3000, "learn-2");
    expect(second).toMatchObject({ suggested_type: "fee_income", suggestion_confidence: "medium" });
    expect(second.suggestion_reason).toMatch(/Same description as 1 earlier line posted as/);
    // Money going out with the same words isn't treated as the same thing.
    expect((await importLine("TRF FROM ACME LTD 0014/46", -3000, "learn-3")).suggested_type).toBeNull();
  });
});
