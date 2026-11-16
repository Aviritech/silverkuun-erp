import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const OFFICER = "00000000-0000-0000-0000-0000000002a1";
const OFFICER_ELSEWHERE = "00000000-0000-0000-0000-0000000002a2";
const MANAGER = "00000000-0000-0000-0000-0000000002b1";
const HR = "00000000-0000-0000-0000-0000000002f1";
const HR_2 = "00000000-0000-0000-0000-0000000002f2";

let db: PGlite;
let lagos: string;
let abuja: string;
let ninCounter = 30000000000;
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

function nextHash(): string {
  hashCounter += 1;
  return (0xf000 + hashCounter).toString(16).padStart(64, "0");
}

function clientDetails(nin = String(ninCounter++)) {
  return {
    first_name: "Bola",
    last_name: "Ade",
    phone: "08031112222",
    address: "4 Allen Avenue",
    address_lga: "Ikeja",
    address_state: "Lagos",
    nin,
    id_type: "national_id",
    id_number: "B555",
    gender: "female",
  };
}

/** A client signs up through HR's link with a NIN slip, and HR returns the file. */
async function returnedSignup(): Promise<{ memberId: string; ninPath: string }> {
  const hash = nextHash();
  await commitAs(HR, () => db.query("select create_member_signup_link($1, $2, 'Bola Ade', 3)", [hash, lagos]));
  const memberId = crypto.randomUUID();
  const ninPath = `${lagos}/${memberId}/a-nin.pdf`;
  await asService(() =>
    db.query("select submit_member_signup($1, $2, $3, $4)", [
      hash,
      memberId,
      JSON.stringify(clientDetails()),
      JSON.stringify([{ document_type: "nin_slip", file_name: "nin.pdf", storage_path: ninPath, mime_type: "application/pdf", size_bytes: 900 }]),
    ]),
  );
  await commitAs(HR, () => db.query("select return_member($1, 'Your phone number is wrong')", [memberId]));
  return { memberId, ninPath };
}

async function createFixLink(by: string, memberId: string, days = 3): Promise<string> {
  const hash = nextHash();
  await commitAs(by, () => db.query("select create_member_fix_link($1, $2, $3)", [hash, memberId, days]));
  return hash;
}

async function linkStatus(hash: string) {
  return (
    await asService(() =>
      db.query<{ state: string; return_reason: string; member: Record<string, string> | null; documents: { document_type: string }[] | null }>(
        "select state, return_reason, member, documents from member_fix_link_status($1)",
        [hash],
      ),
    )
  ).rows[0];
}

async function submitFix(hash: string, details: object, docs: object[] = []) {
  return asService(() =>
    db.query<{ removed_path: string }>("select * from submit_member_fix($1, $2, $3)", [hash, JSON.stringify(details), JSON.stringify(docs)]),
  );
}

async function member(id: string) {
  return (
    await db.query<{ status: string; phone: string; return_reason: string | null; introduced_by: string }>(
      "select status, phone, return_reason, introduced_by from members where id = $1",
      [id],
    )
  ).rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
  const region = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [region.rows[0].id]))
    .rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [region.rows[0].id]))
    .rows[0].id;
  await addStaff(OFFICER, "administration", "admin_officer", lagos);
  await addStaff(OFFICER_ELSEWHERE, "administration", "admin_officer", abuja);
  await addStaff(MANAGER, "branch_operations", "branch_manager", lagos);
  await addStaff(HR, "hr", "hr_officer", lagos);
  await addStaff(HR_2, "hr", "hr_officer", lagos);
});

describe("fix links for returned sign-ups", () => {
  it("lets the client correct their returned file, which goes back to the staff member who brought them in", async () => {
    const { memberId, ninPath } = await returnedSignup();
    const hash = await createFixLink(HR, memberId);

    const status = await linkStatus(hash);
    expect(status.state).toBe("open");
    expect(status.return_reason).toBe("Your phone number is wrong");
    expect(status.member?.phone).toBe("08031112222");
    expect(status.documents).toEqual([{ document_type: "nin_slip", file_name: "nin.pdf" }]);

    const current = status.member!;
    const removed = await submitFix(hash, { ...current, phone: "08039998888" }, [
      { document_type: "nin_slip", file_name: "nin2.pdf", storage_path: `${lagos}/${memberId}/b-nin.pdf`, mime_type: "application/pdf", size_bytes: 800 },
    ]);
    expect(removed.rows).toEqual([{ removed_path: ninPath }]);
    expect(await member(memberId)).toMatchObject({ status: "with_marketer", phone: "08039998888", return_reason: null, introduced_by: HR });
    const docs = await db.query<{ file_name: string; uploaded_by: string }>("select file_name, uploaded_by from member_documents where member_id = $1", [memberId]);
    expect(docs.rows).toEqual([{ file_name: "nin2.pdf", uploaded_by: HR }]);

    // One use only, and the details are no longer shown.
    const after = await linkStatus(hash);
    expect(after).toMatchObject({ state: "used", member: null, documents: null });
    await expect(submitFix(hash, current)).rejects.toThrow(/already been used/);

    // HR confirms as before.
    await commitAs(HR, () => db.query("select marketer_review_member($1, 'Fixed')", [memberId]));
    expect((await member(memberId)).status).toBe("marketer_reviewed");
  });

  it("lets the branch's officer send one too, but not other staff, other branches, or files that aren't returned", async () => {
    const { memberId } = await returnedSignup();
    await expect(createFixLink(HR_2, memberId)).rejects.toThrow(/not found/);
    await expect(createFixLink(OFFICER_ELSEWHERE, memberId)).rejects.toThrow(/not found/);
    await expect(createFixLink(MANAGER, memberId)).rejects.toThrow(/brought this client in, or an officer/);
    await expect(createFixLink(HR, memberId, 10)).rejects.toThrow(/1 to 7 days/);
    const first = await createFixLink(OFFICER, memberId);

    // A newer link replaces the older one.
    const second = await createFixLink(HR, memberId);
    expect((await linkStatus(first)).state).toBe("revoked");
    expect((await linkStatus(second)).state).toBe("open");

    // The officer corrects it themselves and sends it on: the open link closes, and stays closed if it is returned again.
    await commitAs(OFFICER, () => db.query("select send_member_to_staff($1, $2)", [memberId, HR]));
    expect((await linkStatus(second)).state).toBe("revoked");
    await commitAs(HR, () => db.query("select return_member($1, 'Still wrong')", [memberId]));
    expect((await linkStatus(second)).state).toBe("revoked");
    await expect(submitFix(second, clientDetails())).rejects.toThrow(/expired or has already been used/);

    // Staff-typed files and files that aren't returned can't get one.
    await expect(createFixLink(HR, (await returnedSignup()).memberId)).resolves.toBeTruthy();
    const typed = await commitAs(OFFICER, () =>
      db.query<{ id: string }>(
        `insert into members (branch_id, first_name, last_name, phone, address, nin, id_type, id_number)
         values ($1, 'Ada', 'Obi', '08030000000', '1 Marina', $2, 'national_id', 'A1') returning id`,
        [lagos, String(ninCounter++)],
      ),
    );
    await expect(createFixLink(OFFICER, typed.rows[0].id)).rejects.toThrow(/filled in themselves/);
  });

  it("refuses documents clients may not upload and files outside the member's folder", async () => {
    const { memberId } = await returnedSignup();
    const hash = await createFixLink(HR, memberId);
    const current = (await linkStatus(hash)).member!;
    await expect(
      submitFix(hash, current, [{ document_type: "kyc_form", file_name: "k.pdf", storage_path: `${lagos}/${memberId}/k.pdf`, mime_type: "application/pdf", size_bytes: 1 }]),
    ).rejects.toThrow(/only their NIN slip/);
    await expect(
      submitFix(hash, current, [{ document_type: "utility_bill", file_name: "u.pdf", storage_path: `${lagos}/other/u.pdf`, mime_type: "application/pdf", size_bytes: 1 }]),
    ).rejects.toThrow(/member's folder/);
    expect((await member(memberId)).status).toBe("returned");
    expect((await linkStatus(hash)).state).toBe("open");
  });

  it("keeps the public functions and token hashes away from signed-in staff and anonymous visitors", async () => {
    const { memberId } = await returnedSignup();
    const hash = await createFixLink(HR, memberId);
    await expect(asUser(db, HR, (c) => c.query("select * from member_fix_link_status($1)", [hash]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, HR, (c) => c.query("select * from submit_member_fix($1, '{}', '[]')", [hash]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, HR, (c) => c.query("select token_hash from member_fix_links"))).rejects.toThrow(/permission denied/);
    const own = await asUser(db, HR, (c) => c.query("select id from member_fix_links where member_id = $1", [memberId]));
    expect(own.rows).toHaveLength(1);
    const other = await asUser(db, OFFICER_ELSEWHERE, (c) => c.query("select id from member_fix_links where member_id = $1", [memberId]));
    expect(other.rows).toHaveLength(0);
    await db.exec("begin; set local role anon;");
    try {
      await expect(db.query("select * from member_fix_link_status($1)", [hash])).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }
    await expect(
      asUser(db, HR, (c) => c.query("insert into member_fix_links (token_hash, member_id, return_reason, expires_at) values ($1, $2, 'x', now() + interval '1 day')", [nextHash(), memberId])),
    ).rejects.toThrow(/permission denied/);
  });
});
