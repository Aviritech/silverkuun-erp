import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";
import { people, twoBranches } from "./people";

let db: PGlite;
let h: ReturnType<typeof people>;
let lagos: string;
let abuja: string;

const PAYROLL_OFFICER = crypto.randomUUID();
const HEAD_OF_HR = crypto.randomUUID();
const CONTROLLER = crypto.randomUUID();
const OUTSIDER = crypto.randomUUID();

type Person = { id: string; staffId: string | null };
let ada: Person; // Lagos, ₦300,000 a month, pays rent
let bayo: Person; // Abuja, joins mid-month
let chi: Person; // no salary yet

const n = (v: unknown) => Number(v);

async function proposeAndApprove(employeeId: string, from: string, pay: Record<string, number>) {
  const res = await h.commitAs(PAYROLL_OFFICER, () =>
    db.query<{ id: string }>(
      `insert into employee_salaries (employee_id, effective_from, basic, housing, transport, medical, utility, other_allowance, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'Appointment') returning id`,
      [employeeId, from, pay.basic ?? 0, pay.housing ?? 0, pay.transport ?? 0, pay.medical ?? 0, pay.utility ?? 0, pay.other ?? 0],
    ),
  );
  await h.commitAs(HEAD_OF_HR, () => db.query("select decide_salary($1, true)", [res.rows[0].id]));
  return res.rows[0].id;
}

async function line(runId: string, employeeId: string) {
  return (
    await db.query<Record<string, string | number>>("select * from payroll_lines where run_id = $1 and employee_id = $2", [runId, employeeId])
  ).rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
  h = people(db);
  ({ lagos, abuja } = await twoBranches(db));
  await h.addStaff(PAYROLL_OFFICER, "hr", "payroll_officer", null);
  await h.addStaff(HEAD_OF_HR, "hr", "head_of_hr", null);
  await h.addStaff(CONTROLLER, "accounts", "financial_controller", null);
  await h.addStaff(OUTSIDER, "credit", "credit_officer", lagos);

  ada = await h.employee({ branch: lagos, title: "Accountant", department: "accounts", login: true, hired: "2023-05-02" });
  bayo = await h.employee({ branch: abuja, title: "Account Officer", department: "credit", hired: "2026-03-16" });
  chi = await h.employee({ branch: lagos, title: "Supervisor", hired: "2025-01-06" });
  await db.query("update employees set annual_rent = 1200000, bank_name = 'Zenith', bank_account_number = '1234567890' where id = $1", [ada.id]);
});

describe("PAYE", () => {
  it("applies the 2026 bands", async () => {
    const bands = (await db.query<{ paye_bands: unknown }>("select paye_bands from payroll_settings")).rows[0].paye_bands;
    const tax = async (income: number) =>
      n((await db.query<{ t: string }>("select app.paye_annual($1, $2) as t", [income, JSON.stringify(bands)])).rows[0].t);
    expect(await tax(800_000)).toBe(0);
    expect(await tax(3_000_000)).toBe(330_000); // 2.2m × 15%
    expect(await tax(12_000_000)).toBe(1_950_000); // + 9m × 18%
    expect(await tax(60_000_000)).toBe(330_000 + 1_620_000 + 2_730_000 + 5_750_000 + 2_500_000);
  });
});

describe("salaries", () => {
  it("needs someone other than the proposer to approve", async () => {
    const res = await h.commitAs(PAYROLL_OFFICER, () =>
      db.query<{ id: string; status: string }>(
        "insert into employee_salaries (employee_id, effective_from, basic, reason) values ($1, '2026-01-01', 100000, 'Test') returning id, status",
        [chi.id],
      ),
    );
    expect(res.rows[0].status).toBe("pending");
    await expect(h.commitAs(PAYROLL_OFFICER, () => db.query("select decide_salary($1, true)", [res.rows[0].id]))).rejects.toThrow(
      /you can't|salary not found/,
    );
    await expect(h.commitAs(OUTSIDER, () => db.query("select id from employee_salaries"))).resolves.toMatchObject({ rows: [] });
    // Withdrawn, so Chi stays without a salary for the tests below.
    await h.commitAs(PAYROLL_OFFICER, () => db.query("delete from employee_salaries where id = $1", [res.rows[0].id]));
  });

  it("starts salaries on the first of a month", async () => {
    await expect(
      h.commitAs(PAYROLL_OFFICER, () =>
        db.query("insert into employee_salaries (employee_id, effective_from, basic, reason) values ($1, '2026-01-15', 1, 'x')", [chi.id]),
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("a payroll run", () => {
  let runId: string;

  beforeAll(async () => {
    await proposeAndApprove(ada.id, "2026-01-01", { basic: 150000, housing: 75000, transport: 45000, medical: 15000, utility: 15000 });
    await proposeAndApprove(bayo.id, "2026-03-01", { basic: 93000, housing: 31000, transport: 31000 });
    await h.commitAs(PAYROLL_OFFICER, () =>
      db.query(
        `insert into employee_deductions (employee_id, kind, description, monthly_amount, total_amount, start_month)
         values ($1, 'salary_advance', 'January advance', 20000, 30000, '2026-02-01')`,
        [ada.id],
      ),
    );
    const res = await h.commitAs(PAYROLL_OFFICER, () => db.query<{ id: string }>("select id from create_payroll_run('2026-03-01')"));
    runId = res.rows[0].id;
  });

  it("works out each employee's pay", async () => {
    const l = await line(runId, ada.id);
    expect(n(l.gross)).toBe(300000);
    expect(n(l.pension_employee)).toBe(21600); // 8% of 270,000
    expect(n(l.pension_employer)).toBe(27000); // 10% of 270,000
    expect(n(l.nhf)).toBe(3750); // 2.5% of 150,000
    expect(n(l.rent_relief)).toBe(round(240000 / 12)); // 20% of 1.2m, under the cap
    // Taxable: 3.6m − (21,600 + 3,750) × 12 − 240,000 = 3,055,800. Tax: 330,000 + 55,800 × 18% = 340,044 a year.
    expect(n(l.annual_taxable)).toBe(3055800);
    expect(n(l.paye)).toBe(round(340044 / 12));
    expect(n(l.deductions)).toBe(20000);
    expect(n(l.net)).toBe(round(300000 - 21600 - 3750 - 340044 / 12 - 20000));
    expect(l.bank_account_number).toBe("1234567890");
  });

  it("pro-rates someone who joined during the month", async () => {
    const l = await line(runId, bayo.id);
    expect(l.days_paid).toBe(16); // 16 to 31 March
    expect(n(l.basic)).toBe(round((93000 * 16) / 31));
  });

  it("leaves out people with no approved salary and says who they are", async () => {
    expect(await line(runId, chi.id)).toBeUndefined();
    const missing = await h.commitAs(PAYROLL_OFFICER, () =>
      db.query<{ employee_id: string }>("select employee_id from payroll_missing_salaries('2026-03-01')"),
    );
    expect(missing.rows.map((r) => r.employee_id)).toContain(chi.id);
  });

  it("taxes a one-off bonus at the rate it adds, and takes one-off deductions off net pay", async () => {
    await h.commitAs(PAYROLL_OFFICER, () =>
      db.query(
        `insert into payroll_adjustments (run_id, employee_id, kind, description, amount) values
           ($1, $2, 'bonus', 'Q1 bonus', 100000), ($1, $2, 'deduction', 'Lost ID card', 5000)`,
        [runId, ada.id],
      ),
    );
    await h.commitAs(PAYROLL_OFFICER, () => db.query("select recalculate_payroll_run($1)", [runId]));
    const l = await line(runId, ada.id);
    expect(n(l.gross)).toBe(400000);
    // 100,000 on top of 3,055,800 is all in the 18% band.
    expect(n(l.paye)).toBe(round(340044 / 12 + 18000));
    expect(n(l.deductions)).toBe(25000);
  });

  it("is approved by someone who didn't prepare it, and posts balanced journals per branch", async () => {
    await h.commitAs(PAYROLL_OFFICER, () => db.query("select submit_payroll_run($1)", [runId]));
    await expect(
      h.commitAs(PAYROLL_OFFICER, () => db.query("select approve_payroll_run($1)", [runId])),
    ).rejects.toThrow(/payroll run not found/);
    await expect(h.commitAs(PAYROLL_OFFICER, () => db.query("insert into payroll_adjustments (run_id, employee_id, kind, description, amount) values ($1, $2, 'bonus', 'Late', 1)", [runId, ada.id]))).rejects.toThrow(
      /only while the run is a draft/,
    );
    await h.commitAs(CONTROLLER, () => db.query("select approve_payroll_run($1)", [runId]));

    const journals = await db.query<{ branch_id: string; debit: string; credit: string; status: string }>(
      `select e.branch_id, e.status, sum(l.debit) as debit, sum(l.credit) as credit
       from journal_entries e join journal_lines l on l.entry_id = e.id
       where e.payroll_run_id = $1 group by e.id`,
      [runId],
    );
    expect(journals.rows).toHaveLength(2);
    for (const j of journals.rows) {
      expect(j.status).toBe("posted");
      expect(n(j.debit)).toBe(n(j.credit));
    }
    const lagosLines = await db.query<{ account_code: string; credit: string }>(
      `select l.account_code, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.payroll_run_id = $1 and e.branch_id = $2 and l.credit > 0 order by l.account_code`,
      [runId, lagos],
    );
    const credits = Object.fromEntries(lagosLines.rows.map((r) => [r.account_code, n(r.credit)]));
    expect(credits["1320"]).toBe(20000); // the advance being recovered
    expect(credits["2250"]).toBe(5000);
    expect(credits["2241"]).toBe(21600 + 27000);
  });

  it("gives the Financial Controller the names on the payroll, and nothing else from the HR file", async () => {
    const direct = await h.commitAs(CONTROLLER, () => db.query("select id from employees"));
    expect(direct.rows).toHaveLength(0);
    const names = await h.commitAs(CONTROLLER, () =>
      db.query<{ id: string }>("select id from pay_people($1)", [[ada.id, bayo.id, chi.id]]),
    );
    // Chi has no salary and no payslip, so isn't on the payroll.
    expect(names.rows.map((r) => r.id).sort()).toEqual([ada.id, bayo.id].sort());
    const outsider = await h.commitAs(OUTSIDER, () => db.query("select id from pay_people($1)", [[ada.id]]));
    expect(outsider.rows).toHaveLength(0);
  });

  it("shows the payslip to the employee once approved, and to nobody else", async () => {
    const own = await h.commitAs(ada.staffId!, () => db.query("select id from payroll_lines"));
    expect(own.rows).toHaveLength(1);
    const outsider = await h.commitAs(OUTSIDER, () => db.query("select id from payroll_lines"));
    expect(outsider.rows).toHaveLength(0);
  });

  it("stops an advance once it has been recovered", async () => {
    const april = await h.commitAs(PAYROLL_OFFICER, () => db.query<{ id: string }>("select id from create_payroll_run('2026-04-01')"));
    const l = await line(april.rows[0].id, ada.id);
    expect(n(l.deductions)).toBe(10000); // 30,000 advance, 20,000 already recovered in March
  });

  it("leaves commission approved after submission for the next payroll", async () => {
    const may = await h.commitAs(PAYROLL_OFFICER, () => db.query<{ id: string }>("select id from create_payroll_run('2026-05-01')"));
    const mayId = may.rows[0].id;
    await h.commitAs(PAYROLL_OFFICER, () => db.query("select submit_payroll_run($1)", [mayId]));

    await db.exec("select set_config('app.workflow', 'on', false)");
    let payoutId: string;
    try {
      payoutId = (
        await db.query<{ id: string }>(
          "insert into commission_payouts (employee_id, description, amount, payable_from) values ($1, 'Late commission', 50000, '2026-05-01') returning id",
          [ada.id],
        )
      ).rows[0].id;
    } finally {
      await db.exec("select set_config('app.workflow', 'off', false)");
    }

    await h.commitAs(CONTROLLER, () => db.query("select approve_payroll_run($1)", [mayId]));
    expect(n((await line(mayId, ada.id)).commission)).toBe(0);
    const payout = await db.query<{ status: string; payroll_line_id: string | null }>(
      "select status, payroll_line_id from commission_payouts where id = $1",
      [payoutId],
    );
    expect(payout.rows[0]).toEqual({ status: "approved", payroll_line_id: null });
  });

  it("allows one payroll per month", async () => {
    await expect(h.commitAs(PAYROLL_OFFICER, () => db.query("select create_payroll_run('2026-03-01')"))).rejects.toThrow(
      /already a payroll/,
    );
  });
});

function round(v: number) {
  return Math.round(v * 100) / 100;
}
