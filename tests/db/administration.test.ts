import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const OFFICER = "00000000-0000-0000-0000-0000000000a1";
const OFFICER_2 = "00000000-0000-0000-0000-0000000000a2";
const MANAGER = "00000000-0000-0000-0000-0000000000b1";
const MANAGER_ABUJA = "00000000-0000-0000-0000-0000000000b2";
const HEAD = "00000000-0000-0000-0000-0000000000c1";
const AUDITOR = "00000000-0000-0000-0000-0000000000d1";

const REQUIRED_DOCS = ["kyc_form", "nin_slip", "means_of_id", "utility_bill"];

let db: PGlite;
let lagos: string;
let abuja: string;
let ninCounter = 10000000000;

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

async function createDraft(branchId = lagos, by = OFFICER): Promise<string> {
  const nin = String(ninCounter++);
  const res = await commitAs(by, () =>
    db.query<{ id: string }>(
      `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
       values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', $2, 'national_id', 'A123') returning id`,
      [branchId, nin],
    ),
  );
  return res.rows[0].id;
}

async function uploadDocs(memberId: string, branchId = lagos, types = REQUIRED_DOCS) {
  for (const t of types) {
    await commitAs(OFFICER, () =>
      db.query(
        `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
         values ($1, $2, $3, $4, $5, 'application/pdf', 1000)`,
        [memberId, branchId, t, `${t}.pdf`, `${branchId}/${memberId}/${t}-${Math.random()}.pdf`],
      ),
    );
  }
}

async function approvedMember(): Promise<string> {
  const id = await createDraft();
  await uploadDocs(id);
  await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
  await commitAs(MANAGER, () => db.query("select approve_member($1)", [id]));
  return id;
}

async function status(memberId: string) {
  return (await db.query<{ status: string }>("select status from members where id = $1", [memberId])).rows[0].status;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const r1 = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  const r2 = await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [r1.rows[0].id])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [r2.rows[0].id])).rows[0].id;

  await addStaff(OFFICER, "administration", "admin_officer", lagos);
  await addStaff(OFFICER_2, "administration", "admin_officer", lagos);
  await addStaff(MANAGER, "branch_operations", "branch_manager", lagos);
  await addStaff(MANAGER_ABUJA, "branch_operations", "branch_manager", abuja);
  await addStaff(HEAD, "administration", "head_of_administration", null);
  await addStaff(AUDITOR, "internal_audit", "internal_auditor", null);
});

describe("member files", () => {
  it("starts every new file as a draft created by the officer, whatever the request says", async () => {
    const res = await commitAs(OFFICER, () =>
      db.query<{ status: string; created_by: string; membership_no: string | null }>(
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number, status, membership_no)
         values ($1, 'Tunde', 'Bello', '08030000001', 'Ikeja', '29999999999', 'national_id', 'B1', 'approved', 'FAKE-1')
         returning status, created_by, membership_no`,
        [lagos],
      ),
    );
    expect(res.rows[0]).toEqual({ status: "draft", created_by: OFFICER, membership_no: null });
  });

  it("stops an officer creating a file for another branch", async () => {
    await expect(createDraft(abuja)).rejects.toThrow(/row-level security/);
  });

  it("rejects a duplicate NIN", async () => {
    await expect(
      commitAs(OFFICER, () =>
        db.query(
          `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
           values ($1, 'X', 'Y', '08030000002', 'Ikeja', '29999999999', 'national_id', 'C1')`,
          [lagos],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("hides another branch's members from its manager", async () => {
    await createDraft();
    const rows = await asUser(db, MANAGER_ABUJA, (tx) => tx.query("select id from members"));
    expect(rows.rows).toHaveLength(0);
  });

  it("shows every branch's members to the auditor, read-only", async () => {
    const id = await createDraft();
    const rows = await asUser(db, AUDITOR, (tx) => tx.query("select id from members where id = $1", [id]));
    expect(rows.rows).toHaveLength(1);
    const update = await asUser(db, AUDITOR, (tx) => tx.query("update members set phone = '0' where id = $1", [id]));
    expect(update.affectedRows).toBe(0);
  });

  it("stops an officer changing a file's status directly", async () => {
    const id = await createDraft();
    await expect(
      commitAs(OFFICER, () => db.query("update members set status = 'approved' where id = $1", [id])),
    ).rejects.toThrow(/approval workflow/);
  });
});

describe("approval workflow", () => {
  it("won't submit a file until the required documents are uploaded", async () => {
    const id = await createDraft();
    await uploadDocs(id, lagos, ["kyc_form", "nin_slip"]);
    await expect(commitAs(OFFICER, () => db.query("select submit_member($1)", [id]))).rejects.toThrow(
      /missing required documents: means_of_id, utility_bill/,
    );
  });

  it("locks a submitted file and lets only the branch manager approve it", async () => {
    const id = await createDraft();
    await uploadDocs(id);
    await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
    expect(await status(id)).toBe("pending_approval");

    const edit = await asUser(db, OFFICER, (tx) => tx.query("update members set phone = '0809' where id = $1", [id]));
    expect(edit.affectedRows).toBe(0);
    await expect(commitAs(OFFICER, () => db.query("select approve_member($1)", [id]))).rejects.toThrow(/not found/);
    await expect(commitAs(MANAGER_ABUJA, () => db.query("select approve_member($1)", [id]))).rejects.toThrow(/not found/);

    const approved = await commitAs(MANAGER, () =>
      db.query<{ membership_no: string }>("select (approve_member($1)).membership_no", [id]),
    );
    expect(approved.rows[0].membership_no).toMatch(/^KUN-LAG-\d{6}$/);
    expect(await status(id)).toBe("approved");
  });

  it("returns a file with a reason and lets the officer fix and resubmit it", async () => {
    const id = await createDraft();
    await uploadDocs(id);
    await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
    await expect(commitAs(MANAGER, () => db.query("select return_member($1, '  ')", [id]))).rejects.toThrow(/correcting/);
    await commitAs(MANAGER, () => db.query("select return_member($1, 'Utility bill is older than 3 months')", [id]));
    expect(await status(id)).toBe("returned");

    await commitAs(OFFICER, () => db.query("update members set address = '2 Marina' where id = $1", [id]));
    await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
    const row = await db.query<{ status: string; return_reason: string | null }>(
      "select status, return_reason from members where id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({ status: "pending_approval", return_reason: null });
  });

  it("never lets the person who prepared a file approve it", async () => {
    // Give the Lagos manager officer rights too, so they can prepare a file.
    await db.query("insert into staff_roles (staff_id, role_code, branch_id) values ($1, 'admin_officer', $2)", [MANAGER, lagos]);
    const id = await createDraft(lagos, MANAGER);
    await uploadDocs(id);
    await commitAs(MANAGER, () => db.query("select submit_member($1)", [id]));
    await expect(commitAs(MANAGER, () => db.query("select approve_member($1)", [id]))).rejects.toThrow(/someone else/);
    await db.query("delete from staff_roles where staff_id = $1 and role_code = 'admin_officer'", [MANAGER]);
  });

  it("records every step in the audit trail", async () => {
    const id = await approvedMember();
    const trail = await db.query<{ actor_id: string; changed_fields: string[] }>(
      "select actor_id, changed_fields from audit_log where table_name = 'public.members' and record_id = $1 and action = 'UPDATE' order by id",
      [id],
    );
    expect(trail.rows.map((r) => r.actor_id)).toEqual([OFFICER, MANAGER]);
    expect(trail.rows[1].changed_fields).toContain("membership_no");
  });
});

describe("approved members", () => {
  it("can't be edited by an officer", async () => {
    const id = await approvedMember();
    const res = await asUser(db, OFFICER, (tx) => tx.query("update members set phone = '0809' where id = $1", [id]));
    expect(res.affectedRows).toBe(0);
  });

  it("can be corrected by the Head of Administration only with a reason", async () => {
    const id = await approvedMember();
    await expect(
      commitAs(HEAD, () => db.query("update members set phone = '08099999999' where id = $1", [id])),
    ).rejects.toThrow(/need a reason/);
    await commitAs(HEAD, () =>
      db.query("update members set phone = '08099999999', amendment_reason = 'Member changed number' where id = $1", [id]),
    );
    const row = await db.query<{ phone: string }>("select phone from members where id = $1", [id]);
    expect(row.rows[0].phone).toBe("08099999999");
  });

  it("refuses document uploads while a file is with the manager", async () => {
    const id = await createDraft();
    await uploadDocs(id);
    await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
    await expect(uploadDocs(id, lagos, ["other"])).rejects.toThrow(/with the Branch Manager/);
  });
});

describe("plans and contributions", () => {
  async function planFor(memberId: string): Promise<string> {
    const res = await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
         values ($1, $2, 'gold', 50000, 'monthly', '2026-01-01', '2027-01-01') returning id`,
        [memberId, lagos],
      ),
    );
    return res.rows[0].id;
  }

  async function record(planId: string, kind: string, amount: number, extra: { reverses?: string; notes?: string } = {}) {
    return commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reverses_id, notes)
         values ($1, $2, $3, $4, $5, '2026-02-01', 'bank_transfer', $6, $7) returning id`,
        [planId, "00000000-0000-0000-0000-000000000000", lagos, kind, amount, extra.reverses ?? null, extra.notes ?? null],
      ),
    );
  }

  it("only adds plans to approved members", async () => {
    const draft = await createDraft();
    await expect(planFor(draft)).rejects.toThrow(/approved members/);
  });

  it("keeps a running total of contributions and top-ups", async () => {
    const planId = await planFor(await approvedMember());
    await record(planId, "scheduled", 50000);
    await record(planId, "top_up", 20000);
    const totals = await asUser(db, AUDITOR, (tx) =>
      tx.query<{ total_contributed: string; total_top_ups: string; unverified_count: number }>(
        "select total_contributed, total_top_ups, unverified_count::int from member_plan_totals where member_plan_id = $1",
        [planId],
      ),
    );
    expect(totals.rows[0]).toEqual({ total_contributed: "70000.00", total_top_ups: "20000.00", unverified_count: 2 });
  });

  it("never edits or deletes a contribution, and corrects mistakes with a matching reversal", async () => {
    const planId = await planFor(await approvedMember());
    const entry = (await record(planId, "scheduled", 50000)).rows[0].id;

    const officerEdit = await asUser(db, OFFICER, (tx) => tx.query("update contributions set amount = 1 where id = $1", [entry]));
    expect(officerEdit.affectedRows).toBe(0);
    await expect(db.query("update contributions set amount = 1 where id = $1", [entry])).rejects.toThrow(/never edited/);
    await expect(db.query("delete from contributions where id = $1", [entry])).rejects.toThrow(/never deleted/);
    await expect(record(planId, "reversal", -40000, { reverses: entry, notes: "Wrong amount" })).rejects.toThrow(/exactly the original/);
    await expect(record(planId, "reversal", -50000, { reverses: entry })).rejects.toThrow(/contributions_reversal_reason/);

    await record(planId, "reversal", -50000, { reverses: entry, notes: "Posted to wrong member" });
    const total = await db.query<{ total_contributed: string }>(
      "select total_contributed from member_plan_totals where member_plan_id = $1",
      [planId],
    );
    expect(total.rows[0].total_contributed).toBe("0.00");
  });

  it("needs someone other than the recorder to verify a payment", async () => {
    const planId = await planFor(await approvedMember());
    const entry = (await record(planId, "scheduled", 50000)).rows[0].id;
    await expect(commitAs(OFFICER, () => db.query("select verify_contribution($1)", [entry]))).rejects.toThrow(/not found/);
    await commitAs(MANAGER, () => db.query("select verify_contribution($1)", [entry]));
    const totals = await db.query<{ total_verified: string }>(
      "select total_verified from member_plan_totals where member_plan_id = $1",
      [planId],
    );
    expect(totals.rows[0].total_verified).toBe("50000.00");
  });
});

describe("document storage", () => {
  it("lets staff read and upload files only under their own branches' folders", async () => {
    await db.exec(`insert into storage.buckets (id, name, public) values ('member-documents', 'member-documents', false) on conflict do nothing`);
    await commitAs(OFFICER, () =>
      db.query("insert into storage.objects (bucket_id, name) values ('member-documents', $1)", [`${lagos}/m1/kyc.pdf`]),
    );
    await expect(
      commitAs(OFFICER, () =>
        db.query("insert into storage.objects (bucket_id, name) values ('member-documents', $1)", [`${abuja}/m2/kyc.pdf`]),
      ),
    ).rejects.toThrow(/row-level security/);

    const abujaManager = await asUser(db, MANAGER_ABUJA, (tx) => tx.query("select name from storage.objects"));
    const auditor = await asUser(db, AUDITOR, (tx) => tx.query("select name from storage.objects"));
    expect(abujaManager.rows).toHaveLength(0);
    expect(auditor.rows).toHaveLength(1);
  });
});

describe("staff display names", () => {
  it("shows other staff members' names, but nothing else, to signed-in staff", async () => {
    const res = await asUser(db, MANAGER, (tx) =>
      tx.query<Record<string, unknown>>("select * from staff_display_names($1::uuid[])", [[OFFICER, HEAD]]),
    );
    expect(res.rows).toHaveLength(2);
    expect(Object.keys(res.rows[0]).sort()).toEqual(["full_name", "id"]);
  });

  it("returns nothing to someone who isn't active staff", async () => {
    await db.query("update staff set is_active = false where id = $1", [MANAGER]);
    const res = await asUser(db, MANAGER, (tx) => tx.query("select * from staff_display_names($1::uuid[])", [[OFFICER]]));
    await db.query("update staff set is_active = true where id = $1", [MANAGER]);
    expect(res.rows).toHaveLength(0);
  });
});
