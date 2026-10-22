import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";
import { people, twoBranches } from "./people";

let db: PGlite;
let h: ReturnType<typeof people>;
let lagos: string;
let abuja: string;

const HR_OFFICER = crypto.randomUUID();
const CONTROLLER = crypto.randomUUID();

type Person = { id: string; staffId: string | null };
let ada: Person; // Lagos account officer with a commission target
let bola: Person; // Abuja account officer without one

beforeAll(async () => {
  db = await createTestDatabase();
  h = people(db);
  ({ lagos, abuja } = await twoBranches(db));
  await h.addStaff(HR_OFFICER, "hr", "hr_officer", lagos);
  await h.addStaff(CONTROLLER, "accounts", "financial_controller", null);
  ada = await h.employee({ branch: lagos, title: "Account Officer", department: "credit", login: true });
  bola = await h.employee({ branch: abuja, title: "Account Officer", department: "credit", login: true });
});

async function target(): Promise<string> {
  const res = await h.commitAs(HR_OFFICER, () =>
    db.query<{ id: string }>(
      `insert into commission_targets (employee_id, name, period_start, period_end, target_amount, method, rate)
       values ($1, 'Q1 2026 loans', '2026-01-01', '2026-03-31', 1000000, 'percent_of_sales', 2) returning id`,
      [ada.id],
    ),
  );
  return res.rows[0].id;
}

async function sale(targetId: string): Promise<string> {
  const res = await h.commitAs(ada.staffId!, () =>
    db.query<{ id: string }>(
      "insert into commission_sales (target_id, employee_id, client_name, amount, sale_date) values ($1, $2, 'Client', 100000, '2026-02-10') returning id",
      [targetId, ada.id],
    ),
  );
  return res.rows[0].id;
}

describe("names for commission approvers and payroll readers", () => {
  it("lets the Financial Controller see the names of people with targets, without reading HR files", async () => {
    await target();
    const files = await h.commitAs(CONTROLLER, () => db.query("select id from employees"));
    expect(files.rows).toHaveLength(0);

    const names = await h.commitAs(CONTROLLER, () =>
      db.query<{ id: string; employee_no: string }>("select id, employee_no from pay_people($1)", [[ada.id, bola.id]]),
    );
    // Ada has a target; Bola has no target, salary or payslip, so isn't the controller's business.
    expect(names.rows.map((r) => r.id)).toEqual([ada.id]);
  });

  it("gives staff their own name only", async () => {
    const names = await h.commitAs(ada.staffId!, () => db.query<{ id: string }>("select id from pay_people($1)", [[ada.id, bola.id]]));
    expect(names.rows.map((r) => r.id)).toEqual([ada.id]);
  });
});

describe("cancelled targets", () => {
  it("can't have their pending sales approved", async () => {
    const targetId = await target();
    const saleId = await sale(targetId);
    await h.commitAs(HR_OFFICER, () => db.query("update commission_targets set status = 'cancelled' where id = $1", [targetId]));
    await expect(h.commitAs(CONTROLLER, () => db.query("select decide_commission_sale($1, true)", [saleId]))).rejects.toThrow(
      /has been cancelled/,
    );
  });
});
