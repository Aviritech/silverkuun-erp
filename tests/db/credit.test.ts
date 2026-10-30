import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { loanSchedule, type ScheduleTerms } from "@/modules/credit/schedule";
import { asUser, createTestDatabase } from "./harness";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const ADMIN_OFFICER = "00000000-0000-0000-0000-0000000000a1";
const MARKETER = "00000000-0000-0000-0000-0000000000e9";
const BRANCH_MANAGER = "00000000-0000-0000-0000-0000000000b1";
const CREDIT_OFFICER = "00000000-0000-0000-0000-0000000000c1";
const CREDIT_OFFICER_2 = "00000000-0000-0000-0000-0000000000c2";
const ABUJA_OFFICER = "00000000-0000-0000-0000-0000000000c3";
const ANALYST = "00000000-0000-0000-0000-0000000000c4";
const HEAD_OF_CREDIT = "00000000-0000-0000-0000-0000000000c5";
const HEAD_OF_CREDIT_2 = "00000000-0000-0000-0000-0000000000c6";
const ACCOUNTANT = "00000000-0000-0000-0000-0000000000e1";
const ACCOUNTANT_2 = "00000000-0000-0000-0000-0000000000e2";
const CONTROLLER = "00000000-0000-0000-0000-0000000000f1";
const AUDITOR = "00000000-0000-0000-0000-0000000000d1";
const HEAD_OF_BUSINESS = "00000000-0000-0000-0000-0000000000f5";

let db: PGlite;
let lagos: string;
let abuja: string;
let lagosBank: string;
let memberId: string;
let nin = 40000000000;
let ref = 1;

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

const q = <T = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []) =>
  commitAs(userId, () => db.query<T>(sql, params));

async function approvedMember(): Promise<string> {
  const id = (
    await q<{ id: string }>(
      ADMIN_OFFICER,
      `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
       values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', $2, 'national_id', 'A123') returning id`,
      [lagos, String(nin++)],
    )
  ).rows[0].id;
  for (const t of ["kyc_form", "nin_slip", "means_of_id", "utility_bill"]) {
    await q(
      ADMIN_OFFICER,
      `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
       values ($1, $2, $3, 'f.pdf', $4, 'application/pdf', 1000)`,
      [id, lagos, t, `${lagos}/${id}/${t}-${Math.random()}.pdf`],
    );
  }
  await q(ADMIN_OFFICER, "select send_member_to_marketer($1)", [id]);
  await q(MARKETER, "select marketer_review_member($1, null)", [id]);
  await q(ADMIN_OFFICER, "select submit_member($1)", [id]);
  await q(BRANCH_MANAGER, "select approve_member($1, $2)", [id, SIG]);
  return id;
}

type Loan = { id: string; status: string; loan_no: string; branch_id: string };

async function draftLoan(
  fields: Partial<{ amount: number; tenor: number; frequency: string; rate: number; method: string; product: string; member: string }> = {},
  by = CREDIT_OFFICER,
): Promise<Loan> {
  return (
    await q<Loan>(
      by,
      `insert into loans (branch_id, member_id, product_code, phone, address, customer_category, employer_name, monthly_income,
         amount_requested, purpose, tenor_months, repayment_frequency, interest_rate, rate_basis, interest_method, repayment_mode)
       values ($1, $2, $3, '08030000000', '1 Marina, Lagos', 'salary_earner', 'Lagos State Govt', 350000, $4, 'School fees', $5, $6,
         $7, 'per_month', $8, 'salary_deduction')
       returning id, status, loan_no, branch_id`,
      [
        lagos,
        fields.member ?? memberId,
        fields.product ?? "personal",
        fields.amount ?? 120000,
        fields.tenor ?? 4,
        fields.frequency ?? "monthly",
        fields.rate ?? 2.5,
        fields.method ?? "flat",
      ],
    )
  ).rows[0];
}

async function completeApplication(loan: Loan) {
  await q(
    CREDIT_OFFICER,
    `insert into loan_documents (loan_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
     values ($1, $2, 'application_form', 'form.pdf', $3, 'application/pdf', 1000)`,
    [loan.id, loan.branch_id, `${loan.branch_id}/${loan.id}/${Math.random()}.pdf`],
  );
  await q(
    CREDIT_OFFICER,
    `insert into loan_guarantors (loan_id, branch_id, full_name, phone, address, relationship)
     values ($1, $2, 'Bayo Obi', '08031110000', '2 Marina, Lagos', 'Brother')`,
    [loan.id, loan.branch_id],
  );
}

/** The analyst confirms every guarantor on a submitted application. */
async function confirmGuarantors(loan: Loan) {
  await q(ANALYST, "select confirm_loan_guarantor(id, 'Called the guarantor, who confirmed') from loan_guarantors where loan_id = $1", [loan.id]);
}

/** Takes a loan from draft to approved through the real workflow. */
async function approvedLoan(fields: Parameters<typeof draftLoan>[0] = {}): Promise<Loan> {
  const loan = await draftLoan(fields);
  await completeApplication(loan);
  await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
  await confirmGuarantors(loan);
  await q(ANALYST, "select appraise_loan($1, 'clear', 'CRC', '712', 'low', 'approve', $2, 'Steady salary, low obligations')", [
    loan.id,
    fields.amount ?? 120000,
  ]);
  await q(HEAD_OF_CREDIT, "select decide_loan($1, true, $2, null)", [loan.id, fields.amount ?? 120000]);
  await q(HEAD_OF_BUSINESS, "select business_decide_loan($1, true, null)", [loan.id]);
  return loan;
}

type Txn = { id: string; status: string; branch_id: string; interest_amount: string; journal_entry_id: string | null };

async function attach(by: string, txn: Txn, kind = "supporting") {
  await q(
    by,
    `insert into finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
     values ($1, $2, $3, 'e.pdf', $4, 'application/pdf', 100)`,
    [txn.id, txn.branch_id, kind, `${txn.branch_id}/${txn.id}/${Math.random()}.pdf`],
  );
}

/** Accounts pays the loan out: request, approve, then pay with proof. */
async function disburse(loan: Loan, amount: number, daysAgo = 0) {
  const txn = (
    await q<Txn>(
      ACCOUNTANT,
      `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, member_id, loan_id, description, branch_id)
       values ('payment', 'loan_disbursement', current_date - $1::int, $2, $3, $4, $5, 'Disbursement', $6)
       returning id, status, branch_id, interest_amount, journal_entry_id`,
      [daysAgo, amount, lagosBank, memberId, loan.id, lagos],
    )
  ).rows[0];
  await q(ACCOUNTANT, "select submit_finance_transaction($1)", [txn.id]);
  await q(CONTROLLER, "select approve_finance_transaction($1)", [txn.id]);
  await q(AUDITOR, "select audit_approve_payment($1)", [txn.id]);
  await attach(ACCOUNTANT_2, txn, "payment_proof");
  await q(ACCOUNTANT_2, "select pay_finance_transaction($1)", [txn.id]);
  return txn;
}

async function repay(loan: Loan, amount: number, daysAgo = 0): Promise<Txn> {
  const txn = (
    await q<Txn>(
      ACCOUNTANT,
      `insert into finance_transactions (direction, transaction_type, txn_date, amount, bank_account_id, member_id, loan_id, reference,
         description, branch_id)
       values ('receipt', 'loan_repayment', current_date - $1::int, $2, $3, $4, $5, $6, 'Repayment', $7)
       returning id, status, branch_id, interest_amount, journal_entry_id`,
      [daysAgo, amount, lagosBank, memberId, loan.id, `RPY-${ref++}`, lagos],
    )
  ).rows[0];
  await attach(ACCOUNTANT, txn);
  await q(ACCOUNTANT, "select submit_finance_transaction($1)", [txn.id]);
  await q(ACCOUNTANT_2, "select approve_finance_transaction($1)", [txn.id]);
  return (await db.query<Txn>("select id, status, branch_id, interest_amount, journal_entry_id from finance_transactions where id = $1", [txn.id])).rows[0];
}

type Book = {
  status: string;
  outstanding_principal: string;
  outstanding_interest: string;
  principal_repaid: string;
  interest_repaid: string;
  overdue_amount: string;
  missed_repayments: number;
  days_past_due: number;
  remaining_installments: number;
  total_expected: string;
};

async function book(loanId: string): Promise<Book> {
  return (await asUser(db, HEAD_OF_CREDIT, (tx) => tx.query<Book>("select * from loan_book where id = $1", [loanId]))).rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
  const r1 = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  const r2 = await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [r1.rows[0].id])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [r2.rows[0].id])).rows[0].id;

  await addStaff(ADMIN_OFFICER, "administration", "admin_officer", lagos);
  await addStaff(MARKETER, "administration", "marketer", lagos);
  await addStaff(BRANCH_MANAGER, "branch_operations", "branch_manager", lagos);
  await addStaff(CREDIT_OFFICER, "credit", "credit_officer", lagos);
  await addStaff(CREDIT_OFFICER_2, "credit", "credit_officer", lagos);
  await addStaff(ABUJA_OFFICER, "credit", "credit_officer", abuja);
  await addStaff(ANALYST, "credit", "credit_analyst", null);
  await addStaff(HEAD_OF_CREDIT, "credit", "credit_manager", null);
  await addStaff(HEAD_OF_CREDIT_2, "credit", "credit_manager", null);
  await addStaff(ACCOUNTANT, "accounts", "regional_accountant", lagos);
  await addStaff(ACCOUNTANT_2, "accounts", "regional_accountant", lagos);
  await addStaff(CONTROLLER, "accounts", "financial_controller", null);
  await addStaff(AUDITOR, "internal_audit", "internal_auditor", null);
  await addStaff(HEAD_OF_BUSINESS, "management", "head_of_business", null);

  await db.exec(`insert into ledger_accounts (code, name, account_type, parent_code, cash_flow_class) values ('1131', 'Lagos bank', 'asset', '1130', 'cash');`);
  lagosBank = (
    await db.query<{ id: string }>("insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Lagos', '1131') returning id", [lagos])
  ).rows[0].id;
  memberId = await approvedMember();
});

describe("loan schedules", () => {
  it("spreads flat interest evenly and puts rounding on the last instalment", async () => {
    const { rows } = await db.query<{ installment_no: number; due_date: Date; principal_due: string; interest_due: string }>(
      "select * from loan_schedule(100000, 2.5, 'per_month', 'flat', 'monthly', 3, '2026-01-31')",
    );
    expect(rows.map((r) => [r.principal_due, r.interest_due])).toEqual([
      ["33333.33", "2500.00"],
      ["33333.33", "2500.00"],
      ["33333.34", "2500.00"],
    ]);
    expect(rows.map((r) => r.due_date.toISOString().slice(0, 10))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("charges reducing-balance interest on what is still owed, with equal instalments", async () => {
    const { rows } = await db.query<{ principal_due: string; interest_due: string }>(
      "select * from loan_schedule(100000, 36, 'per_annum', 'reducing_balance', 'monthly', 6, '2026-01-15')",
    );
    expect(rows).toHaveLength(6);
    expect(rows[0].interest_due).toBe("3000.00");
    expect(rows.reduce((s, r) => s + Number(r.principal_due), 0)).toBeCloseTo(100000, 2);
    const payments = rows.slice(0, 5).map((r) => Number(r.principal_due) + Number(r.interest_due));
    expect(new Set(payments.map((p) => p.toFixed(2))).size).toBe(1);
  });

  it("counts weekly and end-of-term instalments from the tenor", async () => {
    const weekly = await db.query("select * from loan_schedule(50000, 5, 'per_month', 'flat', 'weekly', 3, '2026-01-01')");
    expect(weekly.rows).toHaveLength(13);
    const bullet = await db.query<{ principal_due: string; interest_due: string }>(
      "select * from loan_schedule(50000, 5, 'per_month', 'flat', 'end_of_term', 3, '2026-01-01')",
    );
    expect(bullet.rows).toEqual([expect.objectContaining({ principal_due: "50000.00", interest_due: "7500.00" })]);
  });
});

describe("schedule preview", () => {
  it("matches the database schedule the loan will actually get", async () => {
    const cases: ScheduleTerms[] = [
      { principal: 300000, interestRate: 2.5, rateBasis: "per_month", interestMethod: "flat", frequency: "monthly", tenorMonths: 6, start: "2026-01-31" },
      { principal: 1000000, interestRate: 36, rateBasis: "per_annum", interestMethod: "reducing_balance", frequency: "monthly", tenorMonths: 12, start: "2026-03-15" },
      { principal: 250000, interestRate: 3, rateBasis: "per_month", interestMethod: "reducing_balance", frequency: "weekly", tenorMonths: 3, start: "2026-05-01" },
      { principal: 500000, interestRate: 2, rateBasis: "per_month", interestMethod: "flat", frequency: "quarterly", tenorMonths: 9, start: "2026-02-28", firstDue: "2026-06-01" },
      { principal: 80000, interestRate: 5, rateBasis: "per_month", interestMethod: "flat", frequency: "end_of_term", tenorMonths: 2, start: "2026-07-10" },
    ];
    for (const t of cases) {
      const sql = await db.query<{ installment_no: number; due_date: string; principal_due: string; interest_due: string }>(
        "select installment_no, to_char(due_date, 'YYYY-MM-DD') as due_date, principal_due, interest_due from loan_schedule($1, $2, $3, $4, $5, $6, $7, $8)",
        [t.principal, t.interestRate, t.rateBasis, t.interestMethod, t.frequency, t.tenorMonths, t.start, t.firstDue ?? null],
      );
      const expected = sql.rows.map((r) => ({ ...r, principal_due: Number(r.principal_due), interest_due: Number(r.interest_due) }));
      expect(loanSchedule(t)).toEqual(expected);
    }
  });
});

describe("loan applications", () => {
  it("are raised only for approved members, within the product's limits", async () => {
    await expect(draftLoan({ amount: 10 })).rejects.toThrow(/Personal loan loans are between/);
    await expect(draftLoan({ tenor: 24 })).rejects.toThrow(/at most 12 months/);
    const draftMember = (
      await q<{ id: string }>(
        ADMIN_OFFICER,
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
         values ($1, 'New', 'Person', '08030000001', 'Ikeja', $2, 'national_id', 'B1') returning id`,
        [lagos, String(nin++)],
      )
    ).rows[0].id;
    await expect(draftLoan({ member: draftMember })).rejects.toThrow(/approved members/);
  });

  it("need documents and a guarantor before they go for appraisal", async () => {
    const loan = await draftLoan();
    expect(loan.loan_no).toMatch(/^LN-LAG-\d{6}$/);
    await expect(q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id])).rejects.toThrow(/upload the signed application form/);
    await q(
      CREDIT_OFFICER,
      `insert into loan_documents (loan_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
       values ($1, $2, 'application_form', 'form.pdf', $3, 'application/pdf', 1000)`,
      [loan.id, loan.branch_id, `${loan.branch_id}/${loan.id}/form.pdf`],
    );
    await expect(q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id])).rejects.toThrow(/at least one guarantor/);
  });

  it("asks for a proforma invoice on asset finance", async () => {
    const loan = await draftLoan({ product: "asset", amount: 300000 });
    await completeApplication(loan);
    await expect(q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id])).rejects.toThrow(/proforma invoice/);
  });

  it("keep preparing, appraising and approving with different people", async () => {
    const loan = await draftLoan();
    await completeApplication(loan);
    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
    await expect(q(CREDIT_OFFICER, "update loans set purpose = 'Changed' where id = $1", [loan.id]).then((r) => r.affectedRows)).resolves.toBe(0);
    await expect(
      q(CREDIT_OFFICER, "select appraise_loan($1, 'clear', null, null, 'low', 'approve', 100000, 'Looks fine')", [loan.id]),
    ).rejects.toThrow(/loan not found/);
    await expect(q(HEAD_OF_CREDIT, "select decide_loan($1, true, 100000, null)", [loan.id])).rejects.toThrow(/only appraised/);
    await confirmGuarantors(loan);
    await q(ANALYST, "select appraise_loan($1, 'clear', 'CRC', '700', 'medium', 'approve', 100000, 'Salary covers the instalment')", [
      loan.id,
    ]);
    await expect(q(ANALYST, "select decide_loan($1, true, 100000, null)", [loan.id])).rejects.toThrow(/loan not found/);
    await expect(q(HEAD_OF_CREDIT, "select decide_loan($1, true, 200000, null)", [loan.id])).rejects.toThrow(/no more than the amount requested/);
    const decided = await q<{ status: string; approved_amount: string }>(
      HEAD_OF_CREDIT,
      "select status, approved_amount from decide_loan($1, true, 100000, 'Approved at the recommended amount')",
      [loan.id],
    );
    expect(decided.rows[0]).toEqual({ status: "credit_approved", approved_amount: "100000.00" });

    // Then the Head of Business, who must be someone other than the Head of Credit, before Accounts can pay it out.
    await expect(q(HEAD_OF_CREDIT, "select business_decide_loan($1, true, null)", [loan.id])).rejects.toThrow(/loan not found/);
    await db.query("insert into staff_roles (staff_id, role_code, branch_id) values ($1, 'head_of_business', null)", [HEAD_OF_CREDIT]);
    await expect(q(HEAD_OF_CREDIT, "select business_decide_loan($1, true, null)", [loan.id])).rejects.toThrow(/someone else/);
    await db.query("delete from staff_roles where staff_id = $1 and role_code = 'head_of_business'", [HEAD_OF_CREDIT]);
    const awaiting = await asUser(db, ACCOUNTANT, (tx) => tx.query("select id from loans_awaiting_disbursement where id = $1", [loan.id]));
    expect(awaiting.rows).toHaveLength(0);
    const final = await q<{ status: string; business_approved_by: string }>(
      HEAD_OF_BUSINESS,
      "select status, business_approved_by from business_decide_loan($1, true, 'Fits the business plan')",
      [loan.id],
    );
    expect(final.rows[0]).toEqual({ status: "approved", business_approved_by: HEAD_OF_BUSINESS });
  });

  it("lets the Head of Business return or reject what the Head of Credit approved", async () => {
    const toBusiness = async () => {
      const loan = await draftLoan();
      await completeApplication(loan);
      await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
      await confirmGuarantors(loan);
      await q(ANALYST, "select appraise_loan($1, 'clear', 'CRC', '700', 'low', 'approve', 120000, 'Salary covers the instalment')", [loan.id]);
      await q(HEAD_OF_CREDIT, "select decide_loan($1, true, 120000, null)", [loan.id]);
      return loan;
    };
    const returned = await toBusiness();
    await expect(q(HEAD_OF_CREDIT, "select return_loan($1, 'Second thoughts')", [returned.id])).rejects.toThrow(/with the Head of Business/);
    await q(HEAD_OF_BUSINESS, "select return_loan($1, 'Reduce the tenor to three months')", [returned.id]);
    const row = await db.query("select status, approved_amount, approved_by from loans where id = $1", [returned.id]);
    expect(row.rows[0]).toEqual({ status: "returned", approved_amount: null, approved_by: null });

    const rejected = await toBusiness();
    await expect(q(HEAD_OF_BUSINESS, "select business_decide_loan($1, false, '')", [rejected.id])).rejects.toThrow(/reason for rejecting/);
    const r = await q<{ status: string }>(HEAD_OF_BUSINESS, "select status from business_decide_loan($1, false, 'Sector exposure is too high')", [
      rejected.id,
    ]);
    expect(r.rows[0].status).toBe("rejected");
  });

  it("need every guarantor confirmed by someone other than the officer before appraisal", async () => {
    const loan = await draftLoan();
    await completeApplication(loan);
    // Confirmation can't be typed in while preparing.
    await q(CREDIT_OFFICER, "update loan_guarantors set confirmed_by = $2, confirmed_at = now() where loan_id = $1", [loan.id, CREDIT_OFFICER]);
    expect((await db.query("select confirmed_at from loan_guarantors where loan_id = $1", [loan.id])).rows[0]).toEqual({ confirmed_at: null });
    await expect(
      q(ANALYST, "select confirm_loan_guarantor(id, 'Called them') from loan_guarantors where loan_id = $1", [loan.id]),
    ).rejects.toThrow(/while the application is being appraised/);

    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
    await expect(
      q(ANALYST, "select appraise_loan($1, 'clear', 'CRC', '700', 'low', 'approve', 100000, 'Salary covers the instalment')", [loan.id]),
    ).rejects.toThrow(/confirm every guarantor/);
    await expect(
      q(CREDIT_OFFICER, "select confirm_loan_guarantor(id, 'Called them') from loan_guarantors where loan_id = $1", [loan.id]),
    ).rejects.toThrow(/not found/);
    await expect(q(ANALYST, "select confirm_loan_guarantor(id, '') from loan_guarantors where loan_id = $1", [loan.id])).rejects.toThrow(
      /how you confirmed/,
    );
    await confirmGuarantors(loan);
    const g = await db.query("select confirmed_by, confirmation_note from loan_guarantors where loan_id = $1", [loan.id]);
    expect(g.rows[0]).toEqual({ confirmed_by: ANALYST, confirmation_note: "Called the guarantor, who confirmed" });
    await q(ANALYST, "select appraise_loan($1, 'clear', 'CRC', '700', 'low', 'approve', 100000, 'Salary covers the instalment')", [loan.id]);

    // If the application comes back and the officer changes a guarantor, it must be confirmed again.
    await q(HEAD_OF_CREDIT, "select return_loan($1, 'Check the guarantor''s address')", [loan.id]);
    await q(CREDIT_OFFICER, "update loan_guarantors set address = '3 Marina, Lagos' where loan_id = $1", [loan.id]);
    expect((await db.query("select confirmed_at from loan_guarantors where loan_id = $1", [loan.id])).rows[0]).toEqual({ confirmed_at: null });
  });

  it("can be returned with a reason, corrected and sent again, or rejected", async () => {
    const loan = await draftLoan();
    await completeApplication(loan);
    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
    await expect(q(ANALYST, "select return_loan($1, '')", [loan.id])).rejects.toThrow(/say what needs correcting/);
    await q(ANALYST, "select return_loan($1, 'Attach the latest payslip')", [loan.id]);
    await q(CREDIT_OFFICER, "update loans set purpose = 'School fees and books' where id = $1", [loan.id]);
    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
    await confirmGuarantors(loan);
    await q(ANALYST, "select appraise_loan($1, 'adverse', 'CRC', '410', 'high', 'decline', null, 'Two loans in default elsewhere')", [loan.id]);
    await expect(q(HEAD_OF_CREDIT, "select decide_loan($1, false, null, '')", [loan.id])).rejects.toThrow(/reason for rejecting/);
    const rejected = await q<{ status: string }>(HEAD_OF_CREDIT, "select status from decide_loan($1, false, null, 'Adverse bureau report')", [
      loan.id,
    ]);
    expect(rejected.rows[0].status).toBe("rejected");
  });

  it("stay within the officer's branch, and are read-only to auditors", async () => {
    const loan = await draftLoan();
    const seen = await asUser(db, ABUJA_OFFICER, (tx) => tx.query("select id from loans where id = $1", [loan.id]));
    expect(seen.rows).toHaveLength(0);
    const audited = await asUser(db, AUDITOR, (tx) => tx.query("select id from loans where id = $1", [loan.id]));
    expect(audited.rows).toHaveLength(1);
    await expect(draftLoan({}, AUDITOR)).rejects.toThrow(/row-level security|account officer/);
  });
});

describe("disbursement through Accounts", () => {
  it("pays out exactly the approved amount, then activates the loan with its schedule", async () => {
    const loan = await approvedLoan({ amount: 120000, tenor: 4 });
    const awaiting = await asUser(db, ACCOUNTANT, (tx) => tx.query("select id from loans_awaiting_disbursement where id = $1", [loan.id]));
    expect(awaiting.rows).toHaveLength(1);

    await expect(disburse(loan, 100000)).rejects.toThrow(/approved amount of ₦120,000.00/);
    const txn = await disburse(loan, 120000);

    const row = (
      await asUser(db, CREDIT_OFFICER, (tx) =>
        tx.query<{ status: string; disbursement_status: string; schedule_version: number; maturity_date: Date }>(
          "select status, disbursement_status, schedule_version, maturity_date from loans where id = $1",
          [loan.id],
        ),
      )
    ).rows[0];
    expect(row).toMatchObject({ status: "active", disbursement_status: "posted", schedule_version: 1 });
    const schedule = await asUser(db, CREDIT_OFFICER, (tx) =>
      tx.query<{ principal_due: string; interest_due: string }>(
        "select principal_due, interest_due from loan_schedule_status where loan_id = $1 order by installment_no",
        [loan.id],
      ),
    );
    expect(schedule.rows).toHaveLength(4);
    expect(schedule.rows[0]).toEqual({ principal_due: "30000.00", interest_due: "3000.00" });

    const lines = await db.query<{ account_code: string; debit: string; credit: string }>(
      `select l.account_code, l.debit, l.credit from journal_lines l join finance_transactions t on t.journal_entry_id = l.entry_id
       where t.id = $1 order by l.line_no`,
      [txn.id],
    );
    expect(lines.rows).toEqual([
      { account_code: "1210", debit: "120000.00", credit: "0.00" },
      { account_code: "1131", debit: "0.00", credit: "120000.00" },
    ]);
    await expect(disburse(loan, 120000)).rejects.toThrow(/only approved loans can be paid out/);
  });
});

describe("repayments", () => {
  it("are split into interest and principal by the database, and close the loan when fully paid", async () => {
    const loan = await approvedLoan({ amount: 120000, tenor: 4 });
    await disburse(loan, 120000);

    // Instalments are 30,000 principal + 3,000 interest. 4,000 pays the first instalment's interest and 1,000 principal.
    const first = await repay(loan, 4000);
    expect(first).toMatchObject({ status: "posted", interest_amount: "3000.00" });
    const lines = await db.query<{ account_code: string; credit: string }>(
      "select account_code, credit from journal_lines where entry_id = $1 and credit > 0 order by line_no",
      [first.journal_entry_id],
    );
    expect(lines.rows).toEqual([
      { account_code: "1210", credit: "1000.00" },
      { account_code: "4100", credit: "3000.00" },
    ]);
    let position = await book(loan.id);
    expect(position).toMatchObject({ outstanding_principal: "119000.00", outstanding_interest: "9000.00", interest_repaid: "3000.00" });

    await expect(repay(loan, 200000)).rejects.toThrow(/more than the ₦128,000.00 still owed/);

    // 32,000 finishes instalment one (29,000 principal) and pays instalment two's interest.
    const second = await repay(loan, 32000);
    expect(second.interest_amount).toBe("3000.00");
    await repay(loan, 96000);
    position = await book(loan.id);
    expect(position).toMatchObject({ status: "closed", outstanding_principal: "0.00", outstanding_interest: "0.00", total_expected: "132000.00" });
  });

  it("reopens a closed loan when Accounts reverses a repayment", async () => {
    const loan = await approvedLoan({ amount: 60000, tenor: 2 });
    await disburse(loan, 60000);
    const all = await repay(loan, 63000);
    expect((await book(loan.id)).status).toBe("closed");
    const entry = (await db.query<{ journal_entry_id: string }>("select journal_entry_id from finance_transactions where id = $1", [all.id])).rows[0];
    await q(CONTROLLER, "select reverse_journal_entry($1, 'Bounced transfer')", [entry.journal_entry_id]);
    expect(await book(loan.id)).toMatchObject({ status: "active", outstanding_principal: "60000.00", outstanding_interest: "3000.00" });
  });

  it("shows arrears: amount overdue, missed repayments and days past due, and flags them for Internal Audit", async () => {
    const loan = await approvedLoan({ amount: 90000, tenor: 3 });
    await disburse(loan, 90000, 75);
    // Two instalments of 32,250 fell due 45 and 15 days ago; 10,000 was paid.
    await repay(loan, 10000, 40);
    const position = await book(loan.id);
    expect(position).toMatchObject({ missed_repayments: 2, days_past_due: expect.any(Number), overdue_amount: "54500.00" });
    expect(position.days_past_due).toBeGreaterThanOrEqual(43);
    const exceptions = await asUser(db, AUDITOR, (tx) =>
      tx.query<{ category: string; severity: string }>("select category, severity from audit_exceptions() where record_id = $1", [loan.id]),
    );
    expect(exceptions.rows).toEqual([{ category: "overdue_loan", severity: "medium" }]);
    const ops = await asUser(db, AUDITOR, (tx) =>
      tx.query<{ loans_disbursed_total: string }>(
        "select sum(loans_disbursed_total)::text as loans_disbursed_total from branch_operations(current_date - 100, current_date)",
      ),
    );
    expect(Number(ops.rows[0].loans_disbursed_total)).toBeGreaterThanOrEqual(90000);
  });
});

describe("restructuring", () => {
  it("needs a second person, and reschedules what is still owed on the new terms", async () => {
    const loan = await approvedLoan({ amount: 120000, tenor: 4 });
    await disburse(loan, 120000, 40);
    await repay(loan, 33000, 5);
    const firstDue = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const request = (
      await q<{ id: string }>(
        CREDIT_OFFICER,
        "select id from request_loan_restructure($1, 6, 'monthly', 2.5, 'per_month', 'flat', $2, 'Customer lost overtime pay')",
        [loan.id, firstDue],
      )
    ).rows[0];
    await expect(q(CREDIT_OFFICER, "select decide_loan_restructure($1, true, null)", [request.id])).rejects.toThrow(/loan.*not found|restructure not found/);
    await q(HEAD_OF_CREDIT, "select decide_loan_restructure($1, true, 'Agreed with the customer')", [request.id]);

    const position = await book(loan.id);
    expect(position).toMatchObject({ status: "active", outstanding_principal: "90000.00", remaining_installments: 6 });
    // Earlier repayments still count towards what the customer has paid in total.
    expect(position.principal_repaid).toBe("30000.00");
    const restructure = (
      await asUser(db, AUDITOR, (tx) => tx.query<{ status: string; outstanding_principal: string }>("select status, outstanding_principal from loan_restructures where id = $1", [request.id]))
    ).rows[0];
    expect(restructure).toEqual({ status: "approved", outstanding_principal: "90000.00" });
  });
});

describe("reminders", () => {
  it("are recorded by the account officer for active loans only", async () => {
    const draft = await draftLoan();
    await expect(
      q(CREDIT_OFFICER, "insert into loan_reminders (loan_id, branch_id, kind, channel) values ($1, $2, 'upcoming', 'sms')", [draft.id, lagos]),
    ).rejects.toThrow(/active loans/);
    const loan = await approvedLoan();
    await disburse(loan, 120000);
    await q(CREDIT_OFFICER_2, "insert into loan_reminders (loan_id, branch_id, kind, channel, note) values ($1, $2, 'upcoming', 'call', 'Will pay Friday')", [
      loan.id,
      lagos,
    ]);
    const seen = await asUser(db, CREDIT_OFFICER, (tx) => tx.query("select * from loan_reminders where loan_id = $1", [loan.id]));
    expect(seen.rows).toHaveLength(1);
    await expect(
      q(HEAD_OF_CREDIT_2, "insert into loan_reminders (loan_id, branch_id, kind, channel) values ($1, $2, 'upcoming', 'sms')", [loan.id, abuja]),
    ).rejects.toThrow(/row-level security/);
  });
});
