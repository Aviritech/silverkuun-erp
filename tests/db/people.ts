import type { PGlite } from "@electric-sql/pglite";

/** Test helpers for HR: staff with roles, and employees with or without a login. */
export function people(db: PGlite) {
  let counter = 0;

  async function addStaff(id: string, department: string, role: string | null, branchId: string | null) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
    await db.query("insert into staff (id, full_name, email, department_code) values ($1::uuid, $1::text, $2, $3)", [
      id,
      `${id}@kuun.test`,
      department,
    ]);
    if (role) await db.query("insert into staff_roles (staff_id, role_code, branch_id) values ($1, $2, $3)", [id, role, branchId]);
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

  async function title(name: string): Promise<string> {
    return (await db.query<{ id: string }>("select id from job_titles where name = $1", [name])).rows[0].id;
  }

  /**
   * An employee entered directly (as the database owner), optionally with a login linked to it.
   * Returns the employee id and, with a login, the staff id.
   */
  async function employee(opts: {
    branch: string;
    title: string;
    department?: string;
    hired?: string;
    gender?: "female" | "male";
    login?: boolean;
    role?: string;
    roleBranch?: string | null;
    employmentType?: string;
  }): Promise<{ id: string; staffId: string | null }> {
    counter += 1;
    let staffId: string | null = null;
    if (opts.login) {
      staffId = crypto.randomUUID();
      await addStaff(staffId, opts.department ?? "administration", opts.role ?? null, opts.roleBranch ?? null);
    }
    // As the workflow functions do, so the record is entered exactly as given: active, with its login linked.
    await db.exec("select set_config('app.workflow', 'on', false)");
    try {
      const hired = opts.hired ?? "2020-01-06";
      const res = await db.query<{ id: string }>(
        `insert into employees (branch_id, department_code, job_title_id, employment_type, hire_date, confirmed_on, status,
           first_name, last_name, gender, phone, address, work_email, staff_id, created_by)
         values ($1, $2, $3, $4, $5, $5, 'active', 'Test', $6, $7, '08030000000', 'Lagos', $8, $9, $10) returning id`,
        [
          opts.branch,
          opts.department ?? "administration",
          await title(opts.title),
          opts.employmentType ?? "permanent",
          hired,
          `Person${counter}`,
          opts.gender ?? "female",
          staffId ? `${staffId}@kuun.test` : null,
          staffId,
          staffId ?? (await db.query<{ id: string }>("select id from staff limit 1")).rows[0].id,
        ],
      );
      return { id: res.rows[0].id, staffId };
    } finally {
      await db.exec("select set_config('app.workflow', 'off', false)");
    }
  }

  return { addStaff, commitAs, title, employee };
}

export async function twoBranches(db: PGlite) {
  const r1 = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  const r2 = await db.query<{ id: string }>("insert into regions (code, name) values ('NC', 'North Central') returning id");
  const lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [r1.rows[0].id])).rows[0].id;
  const ikeja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'IKJ', 'Ikeja') returning id", [r1.rows[0].id])).rows[0].id;
  const abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [r2.rows[0].id])).rows[0].id;
  return { lagos, ikeja, abuja };
}
