import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";
import { people, twoBranches } from "./people";

let db: PGlite;
let h: ReturnType<typeof people>;
let lagos: string;
let abuja: string;

const HR_OFFICER = crypto.randomUUID();
const HEAD_OF_HR = crypto.randomUUID();
const CONTROLLER = crypto.randomUUID();
const AUDITOR = crypto.randomUUID();
const PAYROLL_OFFICER = crypto.randomUUID();

type Person = { id: string; staffId: string | null };
let ada: Person; // Lagos account officer with a login
let manager: Person; // Lagos branch manager, reviews Lagos staff
let abujaManager: Person;

const n = (v: unknown) => Number(v);

beforeAll(async () => {
  db = await createTestDatabase();
  h = people(db);
  ({ lagos, abuja } = await twoBranches(db));
  await h.addStaff(HR_OFFICER, "hr", "hr_officer", lagos);
  await h.addStaff(HEAD_OF_HR, "hr", "head_of_hr", null);
  await h.addStaff(CONTROLLER, "accounts", "financial_controller", null);
  await h.addStaff(AUDITOR, "internal_audit", "internal_auditor", null);
  await h.addStaff(PAYROLL_OFFICER, "hr", "payroll_officer", null);
  ada = await h.employee({ branch: lagos, title: "Account Officer", department: "credit", login: true });
  manager = await h.employee({ branch: lagos, title: "Branch Manager", login: true, role: "branch_manager", roleBranch: lagos });
  abujaManager = await h.employee({ branch: abuja, title: "Branch Manager", login: true, role: "branch_manager", roleBranch: abuja });
});

describe("performance reviews", () => {
  let reviewId: string;

  it("lets a branch manager review their branch's staff, but not other branches or themselves", async () => {
    const start = (by: string, employeeId: string) =>
      h.commitAs(by, () =>
        db.query<{ id: string }>(
          "insert into performance_reviews (employee_id, period_label, period_start, period_end) values ($1, 'Q1 2026', '2026-01-01', '2026-03-31') returning id",
          [employeeId],
        ),
      );
    await expect(start(abujaManager.staffId!, ada.id)).rejects.toThrow(/row-level security/);
    await expect(start(manager.staffId!, manager.id)).rejects.toThrow(/someone else has to review you/);
    reviewId = (await start(manager.staffId!, ada.id)).rows[0].id;
  });

  it("keeps a draft from the employee, then averages the scores on submission", async () => {
    await h.commitAs(manager.staffId!, () =>
      db.query(
        `insert into performance_review_scores (review_id, criterion, score) values
           ($1, 'Loans booked', 4), ($1, 'Repayment follow-up', 5), ($1, 'Teamwork', 3)`,
        [reviewId],
      ),
    );
    const hidden = await h.commitAs(ada.staffId!, () => db.query("select id from performance_reviews"));
    expect(hidden.rows).toHaveLength(0);

    await h.commitAs(manager.staffId!, () => db.query("select submit_performance_review($1)", [reviewId]));
    const seen = await h.commitAs(ada.staffId!, () =>
      db.query<{ overall_score: string; status: string }>("select overall_score, status from performance_reviews"),
    );
    expect(seen.rows[0]).toMatchObject({ status: "submitted" });
    expect(n(seen.rows[0].overall_score)).toBe(4);

    await expect(
      h.commitAs(manager.staffId!, () => db.query("update performance_review_scores set score = 1 where review_id = $1", [reviewId])),
    ).rejects.toThrow(/own draft review/);
  });

  it("is acknowledged by the employee with their comments", async () => {
    await expect(
      h.commitAs(manager.staffId!, () => db.query("select acknowledge_performance_review($1, 'Fine')", [reviewId])),
    ).rejects.toThrow(/review not found/);
    await h.commitAs(ada.staffId!, () => db.query("select acknowledge_performance_review($1, 'Thank you; I will work on teamwork')", [reviewId]));
    const { rows } = await db.query<{ status: string }>("select status from performance_reviews where id = $1", [reviewId]);
    expect(rows[0].status).toBe("acknowledged");
  });
});

describe("goals", () => {
  it("are set by a reviewer and completed by the employee reaching 100%", async () => {
    const goal = await h.commitAs(manager.staffId!, () =>
      db.query<{ id: string }>("insert into employee_goals (employee_id, title, goal_type) values ($1, 'Book 20 loans', 'sales') returning id", [
        ada.id,
      ]),
    );
    await expect(
      h.commitAs(ada.staffId!, () => db.query("insert into employee_goals (employee_id, title) values ($1, 'Self-set')", [ada.id])),
    ).rejects.toThrow(/row-level security|someone else sets/);
    await expect(h.commitAs(ada.staffId!, () => db.query("update employee_goals set progress = 100 where id = $1", [goal.rows[0].id])))
      .resolves.toMatchObject({ rows: [] });
    await h.commitAs(ada.staffId!, () => db.query("select update_goal_progress($1, 100, 'Booked 21')", [goal.rows[0].id]));
    const { rows } = await db.query<{ status: string }>("select status from employee_goals where id = $1", [goal.rows[0].id]);
    expect(rows[0].status).toBe("completed");
  });
});

describe("training", () => {
  let trainingId: string;

  beforeAll(async () => {
    const res = await h.commitAs(HR_OFFICER, () =>
      db.query<{ id: string }>(
        `insert into trainings (title, starts_on, ends_on, hours, capacity, pass_mark, departments)
         values ('Credit risk basics', current_date + 7, current_date + 8, 12, 1, 70, '{credit}') returning id`,
      ),
    );
    trainingId = res.rows[0].id;
  });

  it("lets staff enrol themselves in training for their department while there is room", async () => {
    await expect(h.commitAs(manager.staffId!, () => db.query("select enrol_in_training($1)", [trainingId]))).rejects.toThrow(
      /for other departments/,
    );
    await h.commitAs(ada.staffId!, () => db.query("select enrol_in_training($1)", [trainingId]));
    await expect(h.commitAs(ada.staffId!, () => db.query("select enrol_in_training($1)", [trainingId]))).rejects.toThrow(/full|already enrolled/);
    // HR can enrol anyone, but not past capacity.
    await expect(
      h.commitAs(HR_OFFICER, () => db.query("select enrol_in_training($1, $2)", [trainingId, manager.id])),
    ).rejects.toThrow(/full/);
  });

  it("records results once the training has run, and passes at the pass mark", async () => {
    const enrolment = (await db.query<{ id: string }>("select id from training_enrollments where training_id = $1", [trainingId])).rows[0].id;
    await expect(
      h.commitAs(HR_OFFICER, () => db.query("select record_training_result($1, 'completed', 12, 82)", [enrolment])),
    ).rejects.toThrow(/once the training has started/);
    await db.query("update trainings set starts_on = current_date - 2, ends_on = current_date - 1 where id = $1", [trainingId]);
    await expect(
      h.commitAs(HR_OFFICER, () => db.query("select record_training_result($1, 'completed', 12, null)", [enrolment])),
    ).rejects.toThrow(/enter the score/);
    await h.commitAs(HR_OFFICER, () => db.query("select record_training_result($1, 'completed', 12, 82)", [enrolment]));
    await h.commitAs(ada.staffId!, () => db.query("select give_training_feedback($1, 5, 'Very practical')", [enrolment]));
    const { rows } = await db.query<{ passed: boolean; feedback_rating: number }>(
      "select passed, feedback_rating from training_enrollments where id = $1",
      [enrolment],
    );
    expect(rows[0]).toEqual({ passed: true, feedback_rating: 5 });
  });
});

describe("commission", () => {
  let targetId: string;

  it("pays the target's rate on approved sales, through payroll, after the period", async () => {
    await expect(
      h.commitAs(ada.staffId!, () =>
        db.query(
          "insert into commission_targets (employee_id, name, period_start, period_end, target_amount, method, rate) values ($1, 'x', '2026-01-01', '2026-03-31', 1, 'percent_of_sales', 50)",
          [ada.id],
        ),
      ),
    ).rejects.toThrow(/row-level security|someone else sets/);

    const target = await h.commitAs(HR_OFFICER, () =>
      db.query<{ id: string }>(
        `insert into commission_targets (employee_id, name, period_start, period_end, target_amount, method, rate)
         values ($1, 'Q1 2026 loans', '2026-01-01', '2026-03-31', 5000000, 'percent_of_target_if_met', 1) returning id`,
        [ada.id],
      ),
    );
    targetId = target.rows[0].id;

    const record = (amount: number) =>
      h.commitAs(ada.staffId!, () =>
        db.query<{ id: string }>(
          "insert into commission_sales (target_id, employee_id, client_name, amount, sale_date) values ($1, $2, 'Client', $3, '2026-02-10') returning id",
          [targetId, ada.id, amount],
        ),
      );
    const s1 = (await record(3000000)).rows[0].id;
    const s2 = (await record(2500000)).rows[0].id;

    await expect(h.commitAs(ada.staffId!, () => db.query("select decide_commission_sale($1, true)", [s1]))).rejects.toThrow(
      /sale not found|someone else/,
    );
    await h.commitAs(CONTROLLER, () => db.query("select decide_commission_sale($1, true)", [s1]));
    await expect(h.commitAs(CONTROLLER, () => db.query("select close_commission_target($1)", [targetId]))).rejects.toThrow(
      /pending sales first/,
    );
    await h.commitAs(CONTROLLER, () => db.query("select decide_commission_sale($1, true)", [s2]));
    await h.commitAs(CONTROLLER, () => db.query("select close_commission_target($1)", [targetId]));

    const t = (await db.query<{ achieved: string; commission: string }>("select achieved, commission from commission_targets where id = $1", [targetId])).rows[0];
    expect(n(t.achieved)).toBe(5500000);
    expect(n(t.commission)).toBe(50000); // 1% of the 5m target, met
    const payout = await db.query<{ amount: string; status: string }>("select amount, status from commission_payouts where employee_id = $1", [ada.id]);
    expect(payout.rows).toEqual([{ amount: "50000.00", status: "approved" }]);
  });

  it("works out tiered commission like tax bands", async () => {
    const { rows } = await db.query<{ c: string }>(
      `select app.commission_for(row(null, null, 'x', '2026-01-01', '2026-01-31', 1, 'tiered', null, null,
         '[{"upto": 1000000, "rate": 2}, {"upto": null, "rate": 4}]'::jsonb, 'open', null, null, null, null, now(), null, null)::commission_targets,
         1500000) as c`,
    );
    expect(n(rows[0].c)).toBe(20000 + 20000);
  });
});

describe("whistleblowing", () => {
  it("keeps an anonymous report untraceable, and lets the reporter follow it with the code", async () => {
    const res = await h.commitAs(ada.staffId!, () =>
      db.query<{ reference: string; access_code: string }>(
        "select * from submit_whistleblowing_report('fraud', 'Cash taken from the till', 'Twice last month the cash count was short after closing.', null, 'Lagos', null, true)",
      ),
    );
    const { reference, access_code } = res.rows[0];
    expect(reference).toMatch(/^SU-[0-9A-F]{8}$/);
    expect(access_code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);

    const stored = await db.query<{ reporter_staff_id: string | null }>("select reporter_staff_id from whistleblowing_reports where reference = $1", [reference]);
    expect(stored.rows[0].reporter_staff_id).toBeNull();
    const audit = await db.query("select id from audit_log where table_name = 'public.whistleblowing_reports'");
    expect(audit.rows).toHaveLength(0);

    // Only Internal Audit sees reports; HR and the reporter's managers don't.
    expect((await h.commitAs(HEAD_OF_HR, () => db.query("select id from whistleblowing_reports"))).rows).toHaveLength(0);
    expect((await h.commitAs(manager.staffId!, () => db.query("select id from whistleblowing_reports"))).rows).toHaveLength(0);
    const report = (await h.commitAs(AUDITOR, () => db.query<{ id: string }>("select id from whistleblowing_reports"))).rows[0];

    await h.commitAs(AUDITOR, () =>
      db.query("insert into whistleblowing_messages (report_id, from_reporter, body) values ($1, false, 'Which days exactly?')", [report.id]),
    );
    await h.commitAs(ada.staffId!, () => db.query("select whistleblowing_reply($1, $2, '3rd and 17th')", [reference, access_code]));
    await expect(
      h.commitAs(AUDITOR, () => db.query("update whistleblowing_reports set status = 'resolved' where id = $1", [report.id])),
    ).rejects.toThrow(/record the outcome/);
    await h.commitAs(AUDITOR, () =>
      db.query("update whistleblowing_reports set status = 'resolved', outcome = 'Shortfall recovered; controls tightened' where id = $1", [report.id]),
    );

    const view = await h.commitAs(manager.staffId!, () =>
      db.query<{ status: string; outcome: string; messages: { from_reporter: boolean }[] }>(
        "select status, outcome, messages from whistleblowing_case($1, $2)",
        [reference, access_code.toLowerCase()],
      ),
    );
    expect(view.rows[0]).toMatchObject({ status: "resolved", outcome: "Shortfall recovered; controls tightened" });
    expect(view.rows[0].messages.map((m) => m.from_reporter)).toEqual([false, true]);
    const wrong = await h.commitAs(manager.staffId!, () => db.query("select * from whistleblowing_case($1, 'AAAA-BBBB-CCCC')", [reference]));
    expect(wrong.rows).toHaveLength(0);
  });

  it("can't be edited or deleted outside the investigation fields", async () => {
    const report = (await h.commitAs(AUDITOR, () => db.query<{ id: string }>("select id from whistleblowing_reports limit 1"))).rows[0];
    await expect(
      h.commitAs(AUDITOR, () => db.query("update whistleblowing_reports set description = 'changed text here, long enough' where id = $1", [report.id])),
    ).rejects.toThrow(/can't be changed/);
  });
});

describe("visibility of the payroll side", () => {
  it("lets payroll staff see commission targets so they can follow payouts", async () => {
    const seen = await h.commitAs(PAYROLL_OFFICER, () => db.query("select id from commission_targets"));
    expect(seen.rows.length).toBeGreaterThan(0);
  });
});
