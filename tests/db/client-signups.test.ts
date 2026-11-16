import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const OFFICER = "00000000-0000-0000-0000-0000000001a1";
const OFFICER_2 = "00000000-0000-0000-0000-0000000001a2";
const MANAGER = "00000000-0000-0000-0000-0000000001b1";
const MARKETER = "00000000-0000-0000-0000-0000000001e1";
const HR = "00000000-0000-0000-0000-0000000001f1";
const HR_2 = "00000000-0000-0000-0000-0000000001f2";
const REQUIRED_DOCS = ["kyc_form", "nin_slip", "means_of_id", "utility_bill"];

let db: PGlite;
let lagos: string;
let ninCounter = 20000000000;
let hashCounter = 0;

async function addStaff(id: string, department: string, role: string, branchId: string | null) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
  await db.query("insert into staff (id, full_name, email, department_code) values ($1::uuid, $1::text, $2, $3)", [id, `${id}@kuun.test`, department]);
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

/** As the server does for the public page: the service role, with no signed-in user. */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("begin; set local role service_role;");
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function createDraft(by = OFFICER): Promise<string> {
  const nin = String(ninCounter++);
  const res = await commitAs(by, () =>
    db.query<{ id: string }>(
      `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
       values ($1, 'Ada', 'Obi', '08030000000', '1 Marina, Lagos', $2, 'national_id', 'A123') returning id`,
      [lagos, nin],
    ),
  );
  return res.rows[0].id;
}

async function uploadDocs(memberId: string, types = REQUIRED_DOCS) {
  for (const t of types) {
    await commitAs(OFFICER, () =>
      db.query(
        `insert into member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
         values ($1, $2, $3, $4, $5, 'application/pdf', 1000)`,
        [memberId, lagos, t, `${t}.pdf`, `${lagos}/${memberId}/${t}-${Math.random()}.pdf`],
      ),
    );
  }
}

async function member(id: string) {
  return (
    await db.query<{ status: string; introduced_by: string | null; marketer_id: string | null; source: string; created_by: string }>(
      "select status, introduced_by, marketer_id, source, created_by from members where id = $1",
      [id],
    )
  ).rows[0];
}

function nextHash(): string {
  hashCounter += 1;
  return hashCounter.toString(16).padStart(64, "0");
}

async function createLink(by: string, days = 3): Promise<string> {
  const hash = nextHash();
  await commitAs(by, () => db.query("select create_member_signup_link($1, $2, 'Bola Ade', $3)", [hash, lagos, days]));
  return hash;
}

function signupMember() {
  return {
    first_name: "Bola",
    last_name: "Ade",
    phone: "08031112222",
    address: "4 Allen Avenue",
    address_lga: "Ikeja",
    address_state: "Lagos",
    nin: String(ninCounter++),
    id_type: "national_id",
    id_number: "B555",
    gender: "female",
  };
}

async function submitSignup(hash: string, docs: object[] = []): Promise<string> {
  const id = crypto.randomUUID();
  await asService(() =>
    db.query("select submit_member_signup($1, $2, $3, $4)", [hash, id, JSON.stringify(signupMember()), JSON.stringify(docs)]),
  );
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const region = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [region.rows[0].id]))
    .rows[0].id;
  await addStaff(OFFICER, "administration", "admin_officer", lagos);
  await addStaff(OFFICER_2, "administration", "admin_officer", lagos);
  await addStaff(MANAGER, "branch_operations", "branch_manager", lagos);
  await addStaff(MARKETER, "administration", "marketer", lagos);
  await addStaff(HR, "hr", "hr_officer", lagos);
  await addStaff(HR_2, "hr", "hr_officer", lagos);
});

describe("send to staff", () => {
  it("lets an officer list active staff to name, and nobody else", async () => {
    const names = await asUser(db, OFFICER, (c) => c.query<{ id: string }>("select id from member_introducer_options()"));
    expect(names.rows.map((r) => r.id)).toContain(HR);
    const none = await asUser(db, HR, (c) => c.query("select id from member_introducer_options()"));
    expect(none.rows).toHaveLength(0);
  });

  it("sends the file to the named staff member in any department, and only they confirm it", async () => {
    const id = await createDraft();
    await commitAs(OFFICER, () => db.query("select send_member_to_staff($1, $2)", [id, HR]));
    expect(await member(id)).toMatchObject({ status: "with_marketer", introduced_by: HR });

    // A branch marketer can no longer pick up a file named for someone else.
    await expect(commitAs(MARKETER, () => db.query("select marketer_review_member($1, null)", [id]))).rejects.toThrow(/brought this client in/);
    await expect(commitAs(HR_2, () => db.query("select marketer_review_member($1, null)", [id]))).rejects.toThrow(/not found/);

    // The HR officer can read the file even without Operations access, and confirms it.
    const seen = await asUser(db, HR, (c) => c.query("select id from members where id = $1", [id]));
    expect(seen.rows).toHaveLength(1);
    await commitAs(HR, () => db.query("select marketer_review_member($1, 'My neighbour')", [id]));
    expect(await member(id)).toMatchObject({ status: "marketer_reviewed", marketer_id: HR, introduced_by: HR });

    await uploadDocs(id);
    await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
    await commitAs(MANAGER, () => db.query("select approve_member($1, $2)", [id, SIG]));
    expect((await member(id)).status).toBe("approved");
  });

  it("lets the named staff member return a file they don't recognise", async () => {
    const id = await createDraft();
    await commitAs(OFFICER, () => db.query("select send_member_to_staff($1, $2)", [id, HR]));
    await expect(commitAs(HR_2, () => db.query("select return_member($1, 'Not mine')", [id]))).rejects.toThrow(/not found/);
    await commitAs(HR, () => db.query("select return_member($1, 'I do not know this person')", [id]));
    expect((await member(id)).status).toBe("returned");
  });

  it("won't let the officer preparing the file, or whoever started it, confirm it", async () => {
    const id = await createDraft();
    await expect(commitAs(OFFICER, () => db.query("select send_member_to_staff($1, $2)", [id, OFFICER]))).rejects.toThrow(/can't also confirm/);
    await expect(commitAs(OFFICER_2, () => db.query("select send_member_to_staff($1, $2)", [id, OFFICER]))).rejects.toThrow(/started this file/);
  });

  it("refuses staff who are switched off", async () => {
    const id = await createDraft();
    await db.query("update staff set is_active = false where id = $1", [HR_2]);
    await expect(commitAs(OFFICER, () => db.query("select send_member_to_staff($1, $2)", [id, HR_2]))).rejects.toThrow(/choose the staff member/);
    await db.query("update staff set is_active = true where id = $1", [HR_2]);
  });

  it("stops anyone setting who brought the client in directly", async () => {
    const id = await createDraft();
    await expect(commitAs(OFFICER, () => db.query("update members set introduced_by = $2 where id = $1", [id, HR]))).rejects.toThrow(
      /approval workflow/,
    );
  });

  it("still lets a branch marketer confirm files sent the old way", async () => {
    const id = await createDraft();
    await commitAs(OFFICER, () => db.query("select send_member_to_marketer($1)", [id]));
    await commitAs(MARKETER, () => db.query("select marketer_review_member($1, null)", [id]));
    expect((await member(id)).status).toBe("marketer_reviewed");
  });
});

describe("sign-up links", () => {
  it("lets any active staff member create a link, and see only their own", async () => {
    const hash = await createLink(HR);
    const own = await asUser(db, HR, (c) => c.query("select id from member_signup_links where token_hash = $1", [hash]));
    expect(own.rows).toHaveLength(1);
    const other = await asUser(db, OFFICER, (c) => c.query("select id from member_signup_links where token_hash = $1", [hash]));
    expect(other.rows).toHaveLength(0);
  });

  it("refuses direct writes and links longer than 7 days", async () => {
    await expect(
      asUser(db, HR, (c) =>
        c.query("insert into member_signup_links (token_hash, branch_id, expires_at) values ($1, $2, now() + interval '1 day')", [nextHash(), lagos]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(createLink(HR, 30)).rejects.toThrow(/1 to 7 days/);
  });

  it("keeps the public functions away from signed-in staff and anonymous visitors", async () => {
    const hash = await createLink(HR);
    await expect(asUser(db, HR, (c) => c.query("select * from signup_link_status($1)", [hash]))).rejects.toThrow(/permission denied/);
    await db.exec("begin; set local role anon;");
    try {
      await expect(db.query("select * from signup_link_status($1)", [hash])).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }
  });

  it("creates the client's file with the link's owner, who confirms it before the officer finishes it", async () => {
    const hash = await createLink(HR);
    const status = await asService(() => db.query<{ state: string; staff_name: string }>("select * from signup_link_status($1)", [hash]));
    expect(status.rows[0].state).toBe("open");

    // Files have to sit under the new member's own folder, so a wrong path fails the whole submission.
    await expect(
      submitSignup(hash, [
        { document_type: "nin_slip", file_name: "nin.pdf", storage_path: `${lagos}/elsewhere/nin.pdf`, mime_type: "application/pdf", size_bytes: 900 },
      ]),
    ).rejects.toThrow(/member's folder/);

    const memberId = crypto.randomUUID();
    await asService(() =>
      db.query("select submit_member_signup($1, $2, $3, $4)", [
        hash,
        memberId,
        JSON.stringify(signupMember()),
        JSON.stringify([
          { document_type: "nin_slip", file_name: "nin.pdf", storage_path: `${lagos}/${memberId}/a-nin.pdf`, mime_type: "application/pdf", size_bytes: 900 },
        ]),
      ]),
    );
    expect(await member(memberId)).toMatchObject({ status: "with_marketer", introduced_by: HR, source: "self_signup", created_by: HR });
    const docs = await db.query<{ uploaded_by: string }>("select uploaded_by from member_documents where member_id = $1", [memberId]);
    expect(docs.rows).toEqual([{ uploaded_by: HR }]);

    // Used once only.
    expect((await asService(() => db.query<{ state: string }>("select state from signup_link_status($1)", [hash]))).rows[0].state).toBe("used");
    await expect(submitSignup(hash)).rejects.toThrow(/already been used/);

    // The link's owner confirms; the officer then completes and sends it on.
    await expect(commitAs(OFFICER, () => db.query("select marketer_review_member($1, null)", [memberId]))).rejects.toThrow(/brought this client in/);
    await commitAs(HR, () => db.query("select marketer_review_member($1, 'Met her at church')", [memberId]));
    await uploadDocs(memberId, ["kyc_form", "means_of_id", "utility_bill"]);
    await commitAs(OFFICER, () => db.query("select submit_member($1)", [memberId]));
    await expect(commitAs(HR, () => db.query("select approve_member($1, $2)", [memberId, SIG]))).rejects.toThrow(/not found|prepared/);
    await commitAs(MANAGER, () => db.query("select approve_member($1, $2)", [memberId, SIG]));
    expect((await member(memberId)).status).toBe("approved");
  });

  it("refuses revoked and expired links, and documents clients may not upload", async () => {
    const revoked = await createLink(HR);
    const linkId = (await db.query<{ id: string }>("select id from member_signup_links where token_hash = $1", [revoked])).rows[0].id;
    await expect(commitAs(OFFICER, () => db.query("select revoke_member_signup_link($1)", [linkId]))).rejects.toThrow(/already been used/);
    await commitAs(HR, () => db.query("select revoke_member_signup_link($1)", [linkId]));
    await expect(submitSignup(revoked)).rejects.toThrow(/expired or has already been used/);

    const expired = await createLink(HR, 1);
    await db.query("update member_signup_links set created_at = now() - interval '3 days', expires_at = now() - interval '1 day' where token_hash = $1", [
      expired,
    ]);
    await expect(submitSignup(expired)).rejects.toThrow(/expired/);

    const open = await createLink(HR);
    const memberId = crypto.randomUUID();
    await expect(
      asService(() =>
        db.query("select submit_member_signup($1, $2, $3, $4)", [
          open,
          memberId,
          JSON.stringify(signupMember()),
          JSON.stringify([{ document_type: "kyc_form", file_name: "k.pdf", storage_path: `${lagos}/${memberId}/k.pdf`, mime_type: "application/pdf", size_bytes: 1 }]),
        ]),
      ),
    ).rejects.toThrow(/only their NIN slip/);
    await expect(submitSignup(nextHash())).rejects.toThrow(/not valid/);
  });

  it("rate limits attempts per key", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await asService(() => db.query<{ ok: boolean }>("select signup_rate_check('ip:1.2.3.4', 3, interval '1 hour') as ok"));
      results.push(r.rows[0].ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("my clients", () => {
  it("lists only the members a staff member brought in, with what they have paid", async () => {
    const id = await createDraft();
    await commitAs(OFFICER, () => db.query("select send_member_to_staff($1, $2)", [id, HR_2]));
    await commitAs(HR_2, () => db.query("select marketer_review_member($1, null)", [id]));
    await uploadDocs(id);
    await commitAs(OFFICER, () => db.query("select submit_member($1)", [id]));
    await commitAs(MANAGER, () => db.query("select approve_member($1, $2)", [id, SIG]));
    const plan = await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date, interest_pay_day)
         values ($1, $2, 'silver', 50000, 'monthly', current_date, current_date + 365, 1) returning id`,
        [id, lagos],
      ),
    );
    await commitAs(OFFICER, () =>
      db.query(
        `insert into contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method)
         values ($1, $2, $3, 'scheduled', 50000, current_date, 'cash')`,
        [plan.rows[0].id, id, lagos],
      ),
    );

    const mine = await asUser(db, HR_2, (c) =>
      c.query<{ member_id: string; total_contributed: string; open_plans: number }>("select member_id, total_contributed, open_plans from my_clients()"),
    );
    expect(mine.rows).toEqual([{ member_id: id, total_contributed: "50000.00", open_plans: 1 }]);

    const theirs = await asUser(db, OFFICER, (c) => c.query<{ member_id: string }>("select member_id from my_clients()"));
    expect(theirs.rows.map((r) => r.member_id)).not.toContain(id);
  });
});
