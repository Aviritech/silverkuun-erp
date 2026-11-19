import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";

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
const CONFIRMER = "00000000-0000-0000-0000-0000000000e5";
const AUDITOR = "00000000-0000-0000-0000-0000000000d1";
const HEAD_OF_BUSINESS = "00000000-0000-0000-0000-0000000000f5";

let db: PGlite;
let lagos: string;
let abuja: string;
let memberId: string;
let nin = 40000000000;

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

/** The analyst confirms every guarantor on a submitted application. */
async function confirmGuarantors(loan: Loan) {
  await q(ANALYST, "select confirm_loan_guarantor(id, 'Called the guarantor, who confirmed') from loan_guarantors where loan_id = $1", [loan.id]);
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
  await addStaff(CONFIRMER, "accounts", "receipts_confirmer", null);
  await addStaff(AUDITOR, "internal_audit", "internal_auditor", null);
  await addStaff(HEAD_OF_BUSINESS, "management", "head_of_business", null);

  memberId = await approvedMember();
});


async function upload(loan: Loan, type: string, by = CREDIT_OFFICER) {
  await q(
    by,
    `insert into loan_documents (loan_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
     values ($1, $2, $3::loan_document_type, 'f.pdf', $4, 'application/pdf', 1000)`,
    [loan.id, loan.branch_id, type, `${loan.branch_id}/${loan.id}/${Math.random()}.pdf`],
  );
}

async function addGuarantor(loan: Loan, details: Record<string, string> = {}) {
  await q(
    CREDIT_OFFICER,
    `insert into loan_guarantors (loan_id, branch_id, full_name, phone, address, form_details)
     values ($1, $2, 'Bayo Obi', '08031110000', '2 Marina, Lagos', $3)`,
    [loan.id, loan.branch_id, JSON.stringify(details)],
  );
}

type Line = { item_code: string; required: boolean };
async function lines(form: string): Promise<Line[]> {
  return (await db.query<Line>("select item_code, required from loan_checklist_lines where application_form = $1 order by sort_order", [form])).rows;
}

const allYes = (ls: Line[]) => JSON.stringify(ls.map((l) => ({ item: l.item_code, answer: "yes" })));
const appraise = (loan: Loan) =>
  q(ANALYST, "select appraise_loan($1, 'clear', 'CRC', '712', 'low', 'approve', 100000, 'Steady salary, low obligations')", [loan.id]);

describe("Kuun loan products", () => {
  it("are set up with their forms, guarantors and repayment frequencies", async () => {
    const p = await db.query("select code, name, application_form, min_guarantors, repayment_frequencies from loan_products where application_form <> 'standard' order by code");
    expect(p.rows).toEqual([
      { code: "asset", name: "Kuun Asset Loan", application_form: "kuun_asset", min_guarantors: 1, repayment_frequencies: ["weekly", "monthly"] },
      { code: "payday", name: "Payday loan", application_form: "payday", min_guarantors: 2, repayment_frequencies: ["monthly"] },
      { code: "property_backed", name: "Property-backed loan", application_form: "property_backed", min_guarantors: 1, repayment_frequencies: ["monthly"] },
    ]);
    expect((await lines("payday")).length).toBe(11);
    expect((await lines("property_backed")).length).toBe(13);
    expect((await lines("kuun_asset")).length).toBe(11);
  });

  it("only allow the repayment frequencies on the form", async () => {
    await expect(draftLoan({ product: "payday", frequency: "weekly", amount: 100000, tenor: 3 })).rejects.toThrow(/Payday loan loans are repaid monthly/);
    await expect(draftLoan({ product: "asset", frequency: "quarterly", amount: 300000, tenor: 6 })).rejects.toThrow(/repaid weekly or monthly/);
    const weekly = await draftLoan({ product: "asset", frequency: "weekly", amount: 300000, tenor: 6 });
    expect(weekly.status).toBe("draft");
  });

  it("keep the form's extra answers, editable only while the application is a draft", async () => {
    const loan = await draftLoan({ product: "payday", amount: 100000, tenor: 3 });
    await q(CREDIT_OFFICER, "update loans set form_details = $2 where id = $1", [loan.id, JSON.stringify({ bvn: "22212345678", marital_status: "married" })]);
    const row = await db.query<{ form_details: Record<string, string> }>("select form_details from loans where id = $1", [loan.id]);
    expect(row.rows[0].form_details).toEqual({ bvn: "22212345678", marital_status: "married" });
    await expect(q(CREDIT_OFFICER, "update loans set form_details = '[1]' where id = $1", [loan.id])).rejects.toThrow(/form_details/);
  });

  it("need two guarantors and the signed form for a payday loan", async () => {
    const loan = await draftLoan({ product: "payday", amount: 100000, tenor: 3 });
    await upload(loan, "utility_bill");
    await addGuarantor(loan);
    await expect(q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id])).rejects.toThrow(/need 2 guarantors/);
    await addGuarantor(loan, { bvn: "22200000001" });
    await expect(q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id])).rejects.toThrow(/signed Payday loan application form/);
    await upload(loan, "application_form");
    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
  });

  it("are appraised only after another person ticks every required checklist line Yes", async () => {
    const loan = await draftLoan({ product: "payday", amount: 100000, tenor: 3 });
    await upload(loan, "application_form");
    await addGuarantor(loan);
    await addGuarantor(loan);
    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
    await confirmGuarantors(loan);
    const payday = await lines("payday");

    await expect(appraise(loan)).rejects.toThrow(/compliance checklist before appraising/);
    await expect(
      q(CREDIT_OFFICER, "select record_loan_checklist($1, $2, null, null, null, null)", [loan.id, allYes(payday)]),
    ).rejects.toThrow(/not found|someone else/);
    // Every line must be answered, and a No needs a remark.
    await expect(
      q(ANALYST, "select record_loan_checklist($1, $2, null, null, null, null)", [loan.id, allYes(payday.slice(1))]),
    ).rejects.toThrow(/answer "Signed loan form"/);
    const withNo = payday.map((l) => ({ item: l.item_code, answer: l.item_code === "utility_bill" ? "no" : "yes" }));
    await expect(
      q(ANALYST, "select record_loan_checklist($1, $2, null, null, null, null)", [loan.id, JSON.stringify(withNo)]),
    ).rejects.toThrow(/say what is missing for "Utility bill"/);
    withNo[1] = { ...withNo[1], remark: "Bill is older than 3 months" } as (typeof withNo)[number];
    await q(ANALYST, "select record_loan_checklist($1, $2, '{telephone}', 'satisfactory', 'proceed', null)", [loan.id, JSON.stringify(withNo)]);
    await expect(appraise(loan)).rejects.toThrow(/every line of the compliance checklist must be Yes/);

    // The officer can't write answers directly.
    await q(CREDIT_OFFICER, "update loan_checklist_items set answer = 'yes' where loan_id = $1", [loan.id]);
    expect((await db.query("select answer from loan_checklist_items where loan_id = $1 and item_code = 'utility_bill'", [loan.id])).rows[0]).toEqual({ answer: "no" });

    // Returned, corrected and sent again: the checklist starts over.
    await q(ANALYST, "select return_loan($1, 'Bring a recent utility bill')", [loan.id]);
    await upload(loan, "utility_bill");
    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
    expect((await db.query("select count(*)::int as n from loan_checklist_items where loan_id = $1", [loan.id])).rows[0]).toEqual({ n: 0 });
    await q(ANALYST, "select record_loan_checklist($1, $2, '{telephone,employer_confirmation}', 'satisfactory', 'proceed', 'All seen')", [loan.id, allYes(payday)]);
    await appraise(loan);
    expect((await db.query("select status from loans where id = $1", [loan.id])).rows[0]).toEqual({ status: "appraised" });
  });

  it("let the optional asset loan line be not applicable, but not a required one", async () => {
    const loan = await draftLoan({ product: "asset", amount: 300000, tenor: 6 });
    await upload(loan, "application_form");
    await upload(loan, "proforma_invoice");
    await addGuarantor(loan);
    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
    await confirmGuarantors(loan);
    const asset = await lines("kuun_asset");
    const na = (code: string) => JSON.stringify(asset.map((l) => ({ item: l.item_code, answer: l.item_code === code ? "not_applicable" : "yes" })));
    await expect(q(ANALYST, "select record_loan_checklist($1, $2, null, null, null, null)", [loan.id, na("insurance")])).rejects.toThrow(
      /applies to every application/,
    );
    await q(ANALYST, "select record_loan_checklist($1, $2, '{physical_visit}', 'satisfactory', 'proceed', null)", [loan.id, na("equity")]);
    await appraise(loan);
  });

  it("leave standard products without a checklist", async () => {
    const loan = await draftLoan();
    await upload(loan, "application_form");
    await addGuarantor(loan);
    await q(CREDIT_OFFICER, "select submit_loan($1)", [loan.id]);
    await confirmGuarantors(loan);
    await expect(q(ANALYST, "select record_loan_checklist($1, '[]', null, null, null, null)", [loan.id])).rejects.toThrow(/no compliance checklist/);
    await appraise(loan);
  });
});
