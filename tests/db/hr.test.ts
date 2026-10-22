import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";

const OFFICER = "00000000-0000-0000-0000-0000000000e1"; // HR officer, Lagos only
const HEAD = "00000000-0000-0000-0000-0000000000e2"; // Head of HR, whole organisation
const AUDITOR = "00000000-0000-0000-0000-0000000000e3";
const SYSADMIN = "00000000-0000-0000-0000-0000000000e4";
const OUTSIDER = "00000000-0000-0000-0000-0000000000e5"; // a branch manager with no HR role

let db: PGlite;
let lagos: string;
let abuja: string;
let supervisor: string;
let branchManagerTitle: string;
let emailCounter = 0;

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

type Employee = { id: string; employee_no: string; status: string; staff_id: string | null; work_email: string | null };

async function hire(by = OFFICER, branchId = lagos, extra: Record<string, unknown> = {}): Promise<Employee> {
  const email = `employee${++emailCounter}@silverkuun.test`;
  const fields = {
    branch_id: branchId,
    department_code: "administration",
    job_title_id: supervisor,
    employment_type: "permanent",
    hire_date: "2024-01-15",
    first_name: "Ada",
    last_name: `Obi${emailCounter}`,
    phone: "08030000000",
    address: "1 Marina, Lagos",
    work_email: email,
    ...extra,
  };
  const keys = Object.keys(fields);
  const res = await commitAs(by, () =>
    db.query<Employee>(
      `insert into employees (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})
       returning id, employee_no, status, staff_id, work_email`,
      Object.values(fields),
    ),
  );
  return res.rows[0];
}

/** Creates the Supabase Auth user the app would create, then links it as HR. */
async function giveLogin(employee: Employee): Promise<string> {
  const userId = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [userId, employee.work_email]);
  await commitAs(OFFICER, () => db.query("select link_employee_login($1)", [employee.id]));
  return userId;
}

async function employee(id: string) {
  return (
    await db.query<{ status: string; branch_id: string; job_title_id: string; exit_date: string | null; staff_id: string | null }>(
      "select status, branch_id, job_title_id, exit_date::text, staff_id from employees where id = $1",
      [id],
    )
  ).rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
  const r1 = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  const r2 = await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [r1.rows[0].id])).rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [r2.rows[0].id])).rows[0].id;
  supervisor = (await db.query<{ id: string }>("select id from job_titles where name = 'Supervisor'")).rows[0].id;
  branchManagerTitle = (await db.query<{ id: string }>("select id from job_titles where name = 'Branch Manager'")).rows[0].id;

  await addStaff(OFFICER, "hr", "hr_officer", lagos);
  await addStaff(HEAD, "hr", "head_of_hr", null);
  await addStaff(AUDITOR, "internal_audit", "internal_auditor", null);
  await addStaff(SYSADMIN, "system", "system_admin", null);
  await addStaff(OUTSIDER, "branch_operations", "branch_manager", lagos);
});

describe("employee records", () => {
  it("starts every new starter on probation with a generated number, whatever the request says", async () => {
    const e = await hire(OFFICER, lagos, { status: "active", employee_no: "" });
    expect(e.status).toBe("probation");
    expect(e.employee_no).toMatch(/^SK-\d{5}$/);
    expect(e.staff_id).toBeNull();
  });

  it("keeps numbers brought from the old system and numbers new starters around them", async () => {
    const next = (await db.query<{ n: string }>("select last_value + 1 as n from employee_number_seq")).rows[0].n;
    const taken = `SK-${String(next).padStart(5, "0")}`;
    const imported = await hire(OFFICER, lagos, { employee_no: ` ${taken.toLowerCase()} ` });
    expect(imported.employee_no).toBe(taken);
    const fresh = await hire();
    expect(fresh.employee_no).not.toBe(taken);
    expect(fresh.employee_no).toMatch(/^SK-\d{5}$/);
  });

  it("lets the Head of HR enter existing, already-confirmed staff as active", async () => {
    const e = await hire(HEAD, abuja, { status: "active" });
    expect(e.status).toBe("active");
    const { rows } = await db.query<{ confirmed_on: string }>("select confirmed_on::text from employees where id = $1", [e.id]);
    expect(rows[0].confirmed_on).toBe("2024-01-15");
  });

  it("keeps a branch HR officer to their own branch", async () => {
    await expect(hire(OFFICER, abuja)).rejects.toThrow(/row-level security/);
  });

  it("keeps staff without an HR role out", async () => {
    await expect(hire(OUTSIDER)).rejects.toThrow(/row-level security/);
    const res = await commitAs(OUTSIDER, () => db.query("select id from employees"));
    expect(res.rows).toHaveLength(0);
  });

  it("writes a 'joined' line in the job history", async () => {
    const e = await hire();
    const { rows } = await db.query<{ event: string; effective_date: string }>(
      "select event, effective_date::text from employee_job_history where employee_id = $1",
      [e.id],
    );
    expect(rows).toEqual([{ event: "joined", effective_date: "2024-01-15" }]);
  });

  it("lets HR correct personal details but not status, branch or job title", async () => {
    const e = await hire();
    await commitAs(OFFICER, () => db.query("update employees set phone = '08099999999' where id = $1", [e.id]));
    await expect(commitAs(OFFICER, () => db.query("update employees set status = 'active' where id = $1", [e.id]))).rejects.toThrow(
      /only through confirmations/,
    );
    await expect(
      commitAs(OFFICER, () => db.query("update employees set job_title_id = $2 where id = $1", [e.id, branchManagerTitle])),
    ).rejects.toThrow(/only through confirmations/);
  });

  it("rejects a work email already used by another employee, whatever its case", async () => {
    const e = await hire();
    await expect(hire(OFFICER, lagos, { work_email: e.work_email!.toUpperCase() })).rejects.toThrow(/duplicate key/);
  });

  it("lets auditors read records but not change them", async () => {
    const e = await hire();
    const seen = await commitAs(AUDITOR, () => db.query("select id from employees where id = $1", [e.id]));
    expect(seen.rows).toHaveLength(1);
    const changed = await commitAs(AUDITOR, () => db.query("update employees set phone = '0800' where id = $1 returning id", [e.id]));
    expect(changed.rows).toHaveLength(0);
  });
});

describe("confirmation, job changes, exits and reinstatement", () => {
  it("lets only the Head of HR confirm an appointment", async () => {
    const e = await hire();
    await expect(commitAs(OFFICER, () => db.query("select confirm_employee($1, '2024-07-15')", [e.id]))).rejects.toThrow(
      /employee not found/,
    );
    await expect(commitAs(HEAD, () => db.query("select confirm_employee($1, '2023-01-01')", [e.id]))).rejects.toThrow(
      /between the hire date and today/,
    );
    await commitAs(HEAD, () => db.query("select confirm_employee($1, '2024-07-15')", [e.id]));
    expect((await employee(e.id)).status).toBe("active");
  });

  it("transfers and promotes with a reason, recording each on the job history", async () => {
    const e = await hire();
    await expect(
      commitAs(HEAD, () =>
        db.query("select change_employee_job($1, 'transfer', $2, 'administration', $3, '2025-01-01', '')", [e.id, abuja, supervisor]),
      ),
    ).rejects.toThrow(/give the reason/);
    await expect(
      commitAs(HEAD, () =>
        db.query("select change_employee_job($1, 'transfer', $2, 'administration', $3, '2025-01-01', 'Same everything')", [
          e.id,
          lagos,
          supervisor,
        ]),
      ),
    ).rejects.toThrow(/nothing changes/);

    await commitAs(HEAD, () =>
      db.query("select change_employee_job($1, 'promotion', $2, 'branch_operations', $3, '2025-01-01', 'Opened the Abuja office')", [
        e.id,
        abuja,
        branchManagerTitle,
      ]),
    );
    const after = await employee(e.id);
    expect(after.branch_id).toBe(abuja);
    expect(after.job_title_id).toBe(branchManagerTitle);
    const { rows } = await db.query<{ event: string }>(
      "select event from employee_job_history where employee_id = $1 order by recorded_at",
      [e.id],
    );
    expect(rows.map((r) => r.event)).toEqual(["joined", "promotion"]);

    // The file moved with the employee: the Lagos officer no longer sees it.
    const seen = await commitAs(OFFICER, () => db.query("select id from employees where id = $1", [e.id]));
    expect(seen.rows).toHaveLength(0);
  });

  it("records an exit, ends the contract and switches off the login", async () => {
    const e = await hire();
    const userId = await giveLogin(e);
    await db.query("insert into staff_roles (staff_id, role_code, branch_id) values ($1, 'admin_officer', $2)", [userId, lagos]);
    await commitAs(OFFICER, () =>
      db.query("insert into employee_contracts (employee_id, contract_type, start_date) values ($1, 'permanent', '2024-01-15')", [e.id]),
    );

    await commitAs(HEAD, () => db.query("select record_employee_exit($1, 'resigned', current_date, 'Relocating abroad')", [e.id]));

    const after = await employee(e.id);
    expect(after.status).toBe("resigned");
    const contract = await db.query<{ terminated_on: string | null }>(
      "select terminated_on from employee_contracts where employee_id = $1",
      [e.id],
    );
    expect(contract.rows[0].terminated_on).not.toBeNull();
    const staff = await db.query<{ is_active: boolean }>("select is_active from staff where id = $1", [userId]);
    expect(staff.rows[0].is_active).toBe(false);
    const perms = await commitAs(userId, () => db.query("select * from my_permissions()"));
    expect(perms.rows).toHaveLength(0);

    await expect(
      commitAs(HEAD, () => db.query("select record_employee_exit($1, 'terminated', current_date, 'Again')", [e.id])),
    ).rejects.toThrow(/already left/);
    await expect(commitAs(OFFICER, () => db.query("update employees set exit_date = null where id = $1", [e.id]))).rejects.toThrow(
      /only through confirmations/,
    );
    await expect(commitAs(SYSADMIN, () => db.query("update staff set is_active = true where id = $1", [userId]))).rejects.toThrow(
      /HR has to reinstate them/,
    );

    await commitAs(HEAD, () => db.query("select reinstate_employee($1, 'Withdrew the resignation')", [e.id]));
    expect((await employee(e.id)).status).toBe("probation");
    const back = await db.query<{ is_active: boolean }>("select is_active from staff where id = $1", [userId]);
    expect(back.rows[0].is_active).toBe(true);
  });

  it("stops the Head of HR acting on their own record", async () => {
    const own = await hire(HEAD, lagos, { work_email: `${HEAD}@kuun.test` });
    await commitAs(HEAD, () => db.query("select link_employee_login($1)", [own.id]));
    await expect(
      commitAs(HEAD, () => db.query("select record_employee_exit($1, 'resigned', current_date, 'Testing myself')", [own.id])),
    ).rejects.toThrow(/someone else/);
  });
});

describe("ERP logins", () => {
  it("creates a staff account for the employee's login, which must change its password", async () => {
    const e = await hire();
    const userId = await giveLogin(e);
    const { rows } = await db.query<{ full_name: string; department_code: string; home_branch_id: string; must_change_password: boolean }>(
      "select full_name, department_code, home_branch_id, must_change_password from staff where id = $1",
      [userId],
    );
    expect(rows[0]).toMatchObject({ department_code: "administration", home_branch_id: lagos, must_change_password: true });
    expect((await employee(e.id)).staff_id).toBe(userId);

    // HR can't read staff accounts, but sees whether the login works and what access it has.
    await db.query("insert into staff_roles (staff_id, role_code, branch_id) values ($1, 'admin_officer', $2)", [userId, lagos]);
    const status = await commitAs(OFFICER, () =>
      db.query<{ is_active: boolean; must_change_password: boolean; roles: string[] }>("select * from employee_login_status($1)", [e.id]),
    );
    expect(status.rows[0]).toEqual({ is_active: true, must_change_password: true, roles: ["Administrative Officer"] });
    const hidden = await commitAs(OUTSIDER, () => db.query("select * from employee_login_status($1)", [e.id]));
    expect(hidden.rows).toHaveLength(0);

    await commitAs(userId, () => db.query("select password_changed()"));
    const after = await db.query<{ must_change_password: boolean }>("select must_change_password from staff where id = $1", [userId]);
    expect(after.rows[0].must_change_password).toBe(false);
  });

  it("refuses to link without a work email or a login, or twice", async () => {
    const noEmail = await hire(OFFICER, lagos, { work_email: null });
    await expect(commitAs(OFFICER, () => db.query("select link_employee_login($1)", [noEmail.id]))).rejects.toThrow(
      /add a work email/,
    );
    const noLogin = await hire();
    await expect(commitAs(OFFICER, () => db.query("select link_employee_login($1)", [noLogin.id]))).rejects.toThrow(
      /no login/,
    );
    await giveLogin(noLogin);
    await expect(commitAs(OFFICER, () => db.query("select link_employee_login($1)", [noLogin.id]))).rejects.toThrow(
      /already has an ERP login/,
    );
  });

  it("links an existing staff account without resetting it", async () => {
    const e = await hire(OFFICER, lagos, { work_email: `${OUTSIDER}@kuun.test` });
    const created = await commitAs(OFFICER, () => db.query<{ link_employee_login: boolean }>("select link_employee_login($1)", [e.id]));
    expect(created.rows[0].link_employee_login).toBe(false);
    const { rows } = await db.query<{ full_name: string; must_change_password: boolean }>(
      "select full_name, must_change_password from staff where id = $1",
      [OUTSIDER],
    );
    expect(rows[0].must_change_password).toBe(false);
    // The staff account now takes its name from the HR record.
    expect(rows[0].full_name).toMatch(/^Ada Obi/);
  });

  it("keeps a linked staff account's name and department under HR's control", async () => {
    const e = await hire();
    const userId = await giveLogin(e);
    await expect(
      commitAs(SYSADMIN, () => db.query("update staff set full_name = 'Someone Else' where id = $1", [userId])),
    ).rejects.toThrow(/come from their HR record/);
    await commitAs(OFFICER, () => db.query("update employees set first_name = 'Adaeze' where id = $1", [e.id]));
    const { rows } = await db.query<{ full_name: string }>("select full_name from staff where id = $1", [userId]);
    expect(rows[0].full_name).toMatch(/^Adaeze /);
    await expect(
      commitAs(OFFICER, () => db.query("update employees set work_email = 'new@silverkuun.test' where id = $1", [e.id])),
    ).rejects.toThrow(/signs in with their work email/);
  });

  it("stops a system administrator deactivating their own account", async () => {
    await expect(commitAs(SYSADMIN, () => db.query("update staff set is_active = false where id = $1", [SYSADMIN]))).rejects.toThrow(
      /your own account/,
    );
  });

  it("lets an employee read their own record but nobody else's", async () => {
    const mine = await hire();
    const userId = await giveLogin(mine);
    await commitAs(OFFICER, () =>
      db.query("insert into employee_dependents (employee_id, full_name, relationship) values ($1, 'Chidi Obi', 'child')", [mine.id]),
    );
    const other = await hire();
    const seen = await commitAs(userId, () => db.query<{ id: string }>("select id from employees"));
    expect(seen.rows.map((r) => r.id)).toEqual([mine.id]);
    const deps = await commitAs(userId, () => db.query("select id from employee_dependents"));
    expect(deps.rows).toHaveLength(1);
    const changed = await commitAs(userId, () => db.query("update employees set phone = '0800' where id = $1 returning id", [mine.id]));
    expect(changed.rows).toHaveLength(0);
    expect(other.id).not.toBe(mine.id);
  });
});

describe("contracts and documents", () => {
  it("ends the current contract when a new one starts, and keeps both", async () => {
    const e = await hire();
    await commitAs(OFFICER, () =>
      db.query(
        "insert into employee_contracts (employee_id, contract_type, start_date, end_date) values ($1, 'probation', '2024-01-15', '2024-07-14')",
        [e.id],
      ),
    );
    await expect(
      commitAs(OFFICER, () =>
        db.query("insert into employee_contracts (employee_id, contract_type, start_date) values ($1, 'fixed_term', '2024-07-15')", [e.id]),
      ),
    ).rejects.toThrow(/employee_contracts_end_needed/);
    await commitAs(OFFICER, () =>
      db.query("insert into employee_contracts (employee_id, contract_type, start_date) values ($1, 'permanent', '2024-06-01')", [e.id]),
    );
    const { rows } = await db.query<{ contract_type: string; terminated_on: string | null }>(
      "select contract_type, terminated_on::text from employee_contracts where employee_id = $1 order by start_date",
      [e.id],
    );
    expect(rows).toEqual([
      { contract_type: "probation", terminated_on: "2024-05-31" },
      { contract_type: "permanent", terminated_on: null },
    ]);

    const deleted = await commitAs(OFFICER, () => db.query("delete from employee_contracts where employee_id = $1 returning id", [e.id]));
    expect(deleted.rows).toHaveLength(0);
    await expect(
      commitAs(OFFICER, () =>
        db.query("update employee_contracts set start_date = '2024-02-01' where employee_id = $1 and terminated_on is null", [e.id]),
      ),
    ).rejects.toThrow(/only a contract's end date and notes/);
  });

  it("files documents only under the employee's own folder", async () => {
    const e = await hire();
    const insert = (path: string) =>
      commitAs(OFFICER, () =>
        db.query(
          `insert into employee_documents (employee_id, document_type, file_name, storage_path, mime_type, size_bytes)
           values ($1, 'cv', 'cv.pdf', $2, 'application/pdf', 1000)`,
          [e.id, path],
        ),
      );
    await expect(insert(`${crypto.randomUUID()}/cv.pdf`)).rejects.toThrow(/employee's folder/);
    await insert(`${e.id}/cv.pdf`);
  });
});

describe("job titles", () => {
  it("lets only the Head of HR maintain the list", async () => {
    await expect(commitAs(OFFICER, () => db.query("insert into job_titles (name) values ('Driver')"))).rejects.toThrow(
      /row-level security/,
    );
    await commitAs(HEAD, () => db.query("insert into job_titles (name) values ('Driver')"));
    await expect(commitAs(HEAD, () => db.query("insert into job_titles (name) values (' driver ')"))).rejects.toThrow(/duplicate key/);
  });

  it("won't put a new starter on a retired title", async () => {
    const retired = (
      await commitAs(HEAD, () => db.query<{ id: string }>("insert into job_titles (name, is_active) values ('Typist', false) returning id"))
    ).rows[0].id;
    await expect(hire(OFFICER, lagos, { job_title_id: retired })).rejects.toThrow(/no longer in use/);
  });
});
