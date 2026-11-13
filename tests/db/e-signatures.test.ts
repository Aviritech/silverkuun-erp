import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase } from "./harness";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const HASH = "a".repeat(64);
const ADMIN_OFFICER = "00000000-0000-0000-0000-0000000000a1";
const MARKETER = "00000000-0000-0000-0000-0000000000e9";
const BRANCH_MANAGER = "00000000-0000-0000-0000-0000000000b1";
const CREDIT_OFFICER = "00000000-0000-0000-0000-0000000000c1";
const ABUJA_OFFICER = "00000000-0000-0000-0000-0000000000c3";
const ANALYST = "00000000-0000-0000-0000-0000000000c4";

let db: PGlite;
let lagos: string;
let abuja: string;
let memberId: string;
let agreementId: string;
let loanId: string;
let offerFormId: string;
let guarantorId: string;

async function addStaff(id: string, department: string, role: string, branchId: string | null) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
  await db.query("insert into staff (id, full_name, email, department_code) values ($1::uuid, $2, $3, $4)", [
    id,
    `Staff ${id.slice(-2)}`,
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

const q = <T = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []) => commitAs(userId, () => db.query<T>(sql, params));

type Sig = Partial<{
  member_document_id: string;
  loan_document_id: string;
  loan_guarantor_id: string;
  signer_role: string;
  signer_name: string;
  method: string;
  typed_text: string | null;
  storage_path: string;
}>;

function sign(userId: string, sig: Sig, tx?: PGlite) {
  const branch = sig.member_document_id ? `${lagos}/member` : `${lagos}/loan`;
  const params = [
    sig.member_document_id ?? null,
    sig.loan_document_id ?? null,
    sig.loan_guarantor_id ?? null,
    sig.signer_role ?? "member",
    sig.signer_name ?? "Ada Obi",
    sig.method ?? "drawn",
    sig.typed_text ?? null,
    sig.storage_path ?? `${branch}/${crypto.randomUUID()}.png`,
    HASH,
  ];
  const sql = `insert into e_signatures (member_document_id, loan_document_id, loan_guarantor_id, branch_id, signer_role, signer_name,
      method, typed_text, statement, storage_path, image_sha256, document_sha256, consent_given)
    values ($1, $2, $3, '${lagos}', $4, $5, $6, $7, '-', $8, $9, $9, true)
    returning *`;
  return tx ? tx.query<Record<string, string>>(sql, params) : q<Record<string, string>>(userId, sql, params);
}

beforeAll(async () => {
  db = await createTestDatabase();
  const r1 = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [r1.rows[0].id])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [r1.rows[0].id])).rows[0].id;
  await addStaff(ADMIN_OFFICER, "administration", "admin_officer", lagos);
  await addStaff(MARKETER, "administration", "marketer", lagos);
  await addStaff(BRANCH_MANAGER, "branch_operations", "branch_manager", lagos);
  await addStaff(CREDIT_OFFICER, "credit", "credit_officer", lagos);
  await addStaff(ABUJA_OFFICER, "credit", "credit_officer", abuja);
  await addStaff(ANALYST, "credit", "credit_analyst", null);

  memberId = (
    await q<{ id: string }>(
      ADMIN_OFFICER,
      `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
       values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', '40000000001', 'national_id', 'A123') returning id`,
      [lagos],
    )
  ).rows[0].id;
  for (const t of ["kyc_form", "nin_slip", "means_of_id", "utility_bill", "signed_agreement_letter"]) {
    const res = await q<{ id: string }>(
      ADMIN_OFFICER,
      `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
       values ($1, $2, $3, 'f.pdf', $4, 'application/pdf', 1000) returning id`,
      [memberId, lagos, t, `${lagos}/${memberId}/${t}.pdf`],
    );
    if (t === "signed_agreement_letter") agreementId = res.rows[0].id;
  }
  await q(ADMIN_OFFICER, "select send_member_to_marketer($1)", [memberId]);
  await q(MARKETER, "select marketer_review_member($1, null)", [memberId]);
  await q(ADMIN_OFFICER, "select submit_member($1)", [memberId]);
  await q(BRANCH_MANAGER, "select approve_member($1, $2)", [memberId, SIG]);

  loanId = (
    await q<{ id: string }>(
      CREDIT_OFFICER,
      `insert into loans (branch_id, member_id, product_code, phone, address, customer_category, employer_name, monthly_income,
         amount_requested, purpose, tenor_months, repayment_frequency, interest_rate, rate_basis, interest_method, repayment_mode)
       values ($1, $2, 'personal', '08030000000', '1 Marina, Lagos', 'salary_earner', 'Lagos State Govt', 350000, 120000, 'School fees', 4,
         'monthly', 2.5, 'per_month', 'flat', 'salary_deduction') returning id`,
      [lagos, memberId],
    )
  ).rows[0].id;
  offerFormId = (
    await q<{ id: string }>(
      CREDIT_OFFICER,
      `insert into loan_documents (loan_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
       values ($1, $2, 'application_form', 'form.pdf', $3, 'application/pdf', 1000) returning id`,
      [loanId, lagos, `${lagos}/${loanId}/form.pdf`],
    )
  ).rows[0].id;
  guarantorId = (
    await q<{ id: string }>(
      CREDIT_OFFICER,
      `insert into loan_guarantors (loan_id, branch_id, full_name, phone, address, relationship)
       values ($1, $2, 'Bayo Obi', '08031110000', '2 Marina, Lagos', 'Brother') returning id`,
      [loanId, lagos],
    )
  ).rows[0].id;
});

describe("e-signatures on member documents", () => {
  it("are recorded by the officer with the signer, who recorded it, and what was signed", async () => {
    const { rows } = await sign(ADMIN_OFFICER, { member_document_id: agreementId, method: "typed", typed_text: " Ada Obi " });
    expect(rows[0]).toMatchObject({ signer_role: "member", signer_name: "Ada Obi", typed_text: "Ada Obi", recorded_by: ADMIN_OFFICER, branch_id: lagos });
    expect(rows[0].statement).toMatch(/^Signed Agreement Letter \(f\.pdf\) on the file of Ada Obi, membership no\./);
  });

  it("can be countersigned by the Branch Manager, under the name on their own login", async () => {
    const { rows } = await sign(BRANCH_MANAGER, { member_document_id: agreementId, signer_role: "staff", signer_name: "Someone Else" });
    expect(rows[0]).toMatchObject({ signer_name: `Staff b1`, signer_staff_id: BRANCH_MANAGER });
  });

  it("can't be recorded by staff without access to the member's file", async () => {
    await expect(sign(CREDIT_OFFICER, { member_document_id: agreementId })).rejects.toThrow(/document not found/);
  });

  it("must be stored under the branch's member folder", async () => {
    await expect(sign(ADMIN_OFFICER, { member_document_id: agreementId, storage_path: `${abuja}/member/x.png` })).rejects.toThrow(/folder/);
    await expect(sign(ADMIN_OFFICER, { member_document_id: agreementId, storage_path: `${lagos}/loan/x.png` })).rejects.toThrow(/folder/);
  });

  it("need the typed text when typed, and only then", async () => {
    await expect(sign(ADMIN_OFFICER, { member_document_id: agreementId, method: "typed" })).rejects.toThrow(/check constraint/);
    await expect(sign(ADMIN_OFFICER, { member_document_id: agreementId, typed_text: "Ada" })).rejects.toThrow(/check constraint/);
  });

  it("can't be changed or removed", async () => {
    const changed = await asUser(db, ADMIN_OFFICER, (tx) => tx.query("update e_signatures set signer_name = 'X'"));
    expect(changed.affectedRows).toBe(0);
    await expect(db.query("update e_signatures set signer_name = 'X'")).rejects.toThrow(/can't be changed/);
    const removed = await asUser(db, ADMIN_OFFICER, (tx) => tx.query("delete from e_signatures"));
    expect(removed.affectedRows).toBe(0);
  });

  it("are seen by the member's branch but not by other branches", async () => {
    const officer = await asUser(db, ADMIN_OFFICER, (tx) => tx.query("select id from e_signatures where member_document_id is not null"));
    expect(officer.rows.length).toBe(2);
    const other = await asUser(db, ABUJA_OFFICER, (tx) => tx.query("select id from e_signatures where member_document_id is not null"));
    expect(other.rows.length).toBe(0);
  });
});

describe("e-signatures on loans", () => {
  it("can be added to a loan document by the account officer", async () => {
    const { rows } = await sign(CREDIT_OFFICER, { loan_document_id: offerFormId });
    expect(rows[0].statement).toMatch(/^Application Form \(form\.pdf\) for loan /);
  });

  it("can't be added by another branch's officer", async () => {
    await expect(sign(ABUJA_OFFICER, { loan_document_id: offerFormId })).rejects.toThrow(/document not found/);
  });

  it("let a guarantor sign their guarantee once, under their own name", async () => {
    const { rows } = await sign(CREDIT_OFFICER, { loan_guarantor_id: guarantorId, signer_role: "guarantor", signer_name: "Not Bayo" });
    expect(rows[0].signer_name).toBe("Bayo Obi");
    expect(rows[0].statement).toMatch(/^I stand as guarantor for loan .* of Ada Obi \(120,000\.00 requested, 4 months\)$/);
    await expect(sign(CREDIT_OFFICER, { loan_guarantor_id: guarantorId, signer_role: "guarantor" })).rejects.toThrow(/duplicate key/);
  });

  it("take only the guarantor's own signature on a guarantee", async () => {
    await expect(asUser(db, CREDIT_OFFICER, (tx) => sign(CREDIT_OFFICER, { loan_guarantor_id: guarantorId, signer_role: "member" }, tx))).rejects.toThrow(
      /only the guarantor/,
    );
  });

  it("go with their document when an application document is removed", async () => {
    await q(CREDIT_OFFICER, "delete from loan_documents where id = $1", [offerFormId]);
    const left = await db.query("select id from e_signatures where loan_document_id = $1", [offerFormId]);
    expect(left.rows.length).toBe(0);
  });
});

describe("signature images", () => {
  const put = (tx: PGlite, name: string) => tx.query("insert into storage.objects (bucket_id, name) values ('e-signatures', $1)", [name]);

  it("are uploaded only into a folder the signer may sign in", async () => {
    await asUser(db, ADMIN_OFFICER, (tx) => put(tx, `${lagos}/member/a.png`));
    await asUser(db, CREDIT_OFFICER, (tx) => put(tx, `${lagos}/loan/a.png`));
    await expect(asUser(db, ADMIN_OFFICER, (tx) => put(tx, `${lagos}/loan/b.png`))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, ABUJA_OFFICER, (tx) => put(tx, `${lagos}/loan/b.png`))).rejects.toThrow(/row-level security/);
  });

  it("are read only by staff who can read the document", async () => {
    await db.query("insert into storage.objects (bucket_id, name) values ('e-signatures', $1), ('e-signatures', $2)", [
      `${lagos}/member/m.png`,
      `${lagos}/loan/l.png`,
    ]);
    const read = (id: string) =>
      asUser(db, id, (tx) => tx.query<{ name: string }>("select name from storage.objects where bucket_id = 'e-signatures' order by name"));
    expect((await read(ADMIN_OFFICER)).rows.map((r) => r.name)).toEqual([`${lagos}/member/m.png`]);
    // Credit officers also read member files, so they see both.
    expect((await read(CREDIT_OFFICER)).rows.map((r) => r.name)).toEqual([`${lagos}/loan/l.png`, `${lagos}/member/m.png`]);
    expect((await read(ABUJA_OFFICER)).rows).toEqual([]);
  });
});
