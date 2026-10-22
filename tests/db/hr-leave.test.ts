import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";
import { people, twoBranches } from "./people";

let db: PGlite;
let h: ReturnType<typeof people>;
let lagos: string;
let abuja: string;

let HR_OFFICER: string; // staff id of an HR officer for Lagos (records leave for others)
let HEAD_OF_HR: string; // staff id, organisation-wide
let annual: string;
let sick: string;
let unpaid: string;

type Person = { id: string; staffId: string | null };
let requester: Person;
let relief: Person;
let supervisor: Person;
let otherDeptSupervisor: Person;
let manager: Person;
let hrPerson: Person;
let bystander: Person;

async function leaveType(name: string) {
  return (await db.query<{ id: string }>("select id from leave_types where name = $1", [name])).rows[0].id;
}

/** HR records leave for someone, on fixed dates, so the tests don't depend on today's date. */
async function recordLeave(
  employeeId: string,
  typeId: string,
  start: string,
  end: string,
  extra: { relief?: string; document?: string; by?: string } = {},
) {
  const res = await h.commitAs(extra.by ?? HR_OFFICER, () =>
    db.query<{ id: string; status: string; days: number }>(
      "select id, status, days from request_leave($1, $2, $3, 'Family time', $4, $5, $6)",
      [typeId, start, end, extra.relief ?? null, extra.document ?? null, employeeId],
    ),
  );
  return res.rows[0];
}

async function steps(requestId: string) {
  return (
    await db.query<{ name: string; status: string }>(
      "select name, status from leave_request_steps where request_id = $1 order by step_order",
      [requestId],
    )
  ).rows;
}

async function status(requestId: string) {
  return (await db.query<{ status: string }>("select status from leave_requests where id = $1", [requestId])).rows[0].status;
}

beforeAll(async () => {
  db = await createTestDatabase();
  h = people(db);
  ({ lagos, abuja } = await twoBranches(db));
  HR_OFFICER = crypto.randomUUID();
  HEAD_OF_HR = crypto.randomUUID();
  await h.addStaff(HR_OFFICER, "hr", "hr_officer", lagos);
  await h.addStaff(HEAD_OF_HR, "hr", "head_of_hr", null);
  annual = await leaveType("Annual leave");
  sick = await leaveType("Sick leave");
  unpaid = await leaveType("Unpaid leave");

  requester = await h.employee({ branch: lagos, title: "Accountant", department: "administration", login: true, hired: "2024-03-04" });
  relief = await h.employee({ branch: lagos, title: "Accountant", department: "administration", login: true });
  supervisor = await h.employee({ branch: lagos, title: "Supervisor", department: "administration", login: true });
  otherDeptSupervisor = await h.employee({ branch: lagos, title: "Supervisor", department: "credit", login: true });
  manager = await h.employee({ branch: lagos, title: "Branch Manager", department: "branch_operations", login: true });
  hrPerson = await h.employee({ branch: abuja, title: "HR Officer", department: "hr", login: true });
  bystander = await h.employee({ branch: lagos, title: "Account Officer", department: "credit", login: true });
});

describe("working days and balances", () => {
  it("counts only working days, leaving out weekends and public holidays", async () => {
    // Mon 21 Dec to Mon 28 Dec 2026: six weekdays, less Christmas Day.
    const { rows } = await db.query<{ days: number }>("select app.working_days('2026-12-21', '2026-12-28') as days");
    expect(rows[0].days).toBe(5);
  });

  it("pro-rates the year someone joins and adds long-service days", async () => {
    const newcomer = await h.employee({ branch: lagos, title: "Accountant", hired: "2026-07-15" });
    const veteran = await h.employee({ branch: lagos, title: "Accountant", hired: "2014-02-03" });
    const balance = async (id: string) =>
      (
        await h.commitAs(HR_OFFICER, () =>
          db.query<{ entitlement: number }>("select entitlement from leave_balances($1, 2026) where name = 'Annual leave'", [id]),
        )
      ).rows[0].entitlement;
    expect(await balance(newcomer.id)).toBe(5); // 10 days × 6 of 12 months
    expect(await balance(veteran.id)).toBe(15); // 10 + 5 after ten years
  });

  it("only offers maternity leave to women and paternity leave to men", async () => {
    const { rows } = await h.commitAs(HR_OFFICER, () =>
      db.query<{ name: string }>("select name from leave_balances($1, 2026)", [requester.id]),
    );
    expect(rows.map((r) => r.name)).toContain("Maternity leave");
    expect(rows.map((r) => r.name)).not.toContain("Paternity leave");
  });
});

describe("routing by job title", () => {
  let requestId: string;

  it("builds the chain: relief officer, then the approvers who exist here; steps nobody can approve are skipped", async () => {
    const r = await recordLeave(requester.id, annual, "2026-03-09", "2026-03-13", { relief: relief.id });
    requestId = r.id;
    expect(r).toMatchObject({ status: "pending", days: 5 });
    expect(await steps(requestId)).toEqual([
      { name: "Relief officer", status: "pending" },
      { name: "Supervisor", status: "waiting" },
      { name: "Branch or Marketing Manager", status: "waiting" },
      { name: "Regional Manager", status: "skipped" },
      { name: "Business Development Manager", status: "skipped" },
      { name: "HR", status: "waiting" },
    ]);
  });

  it("lets only the person at the current step act", async () => {
    await expect(h.commitAs(supervisor.staffId!, () => db.query("select approve_leave_step($1)", [requestId]))).rejects.toThrow(
      /nothing on this request for you/,
    );
    await expect(h.commitAs(requester.staffId!, () => db.query("select approve_leave_step($1)", [requestId]))).rejects.toThrow(
      /nothing on this request for you/,
    );
    await h.commitAs(relief.staffId!, () => db.query("select approve_leave_step($1, 'Happy to cover')", [requestId]));
    expect((await steps(requestId))[1].status).toBe("pending");
  });

  it("keeps the supervisor step to the same department", async () => {
    await expect(
      h.commitAs(otherDeptSupervisor.staffId!, () => db.query("select approve_leave_step($1)", [requestId])),
    ).rejects.toThrow(/nothing on this request for you/);
    const inbox = await h.commitAs(supervisor.staffId!, () => db.query<{ request_id: string }>("select request_id from my_leave_approvals()"));
    expect(inbox.rows.map((r) => r.request_id)).toEqual([requestId]);
  });

  it("approves once every remaining step has approved, and the days come off the balance", async () => {
    await h.commitAs(supervisor.staffId!, () => db.query("select approve_leave_step($1)", [requestId]));
    await h.commitAs(manager.staffId!, () => db.query("select approve_leave_step($1)", [requestId]));
    // The HR step is organisation-wide: an HR Officer in Abuja can approve a Lagos request.
    await h.commitAs(hrPerson.staffId!, () => db.query("select approve_leave_step($1)", [requestId]));
    expect(await status(requestId)).toBe("approved");

    const { rows } = await h.commitAs(requester.staffId!, () =>
      db.query<{ taken: number; available: number }>("select taken, available from leave_balances($1, 2026) where name = 'Annual leave'", [
        requester.id,
      ]),
    );
    // Hired March 2024, so 10 days in 2026; five taken.
    expect(rows[0]).toEqual({ taken: 5, available: 5 });
  });

  it("hides requests from colleagues who have no part in them", async () => {
    const seen = await h.commitAs(bystander.staffId!, () => db.query("select id from leave_requests"));
    expect(seen.rows).toHaveLength(0);
    const own = await h.commitAs(requester.staffId!, () => db.query("select id from leave_requests"));
    expect(own.rows.map((r) => (r as { id: string }).id)).toContain(requestId);
  });

  it("sends a request to the Head of HR when nobody in the chain can approve it", async () => {
    const loner = await h.employee({ branch: abuja, title: "Accountant", department: "accounts", login: true });
    const r = await recordLeave(loner.id, annual, "2026-04-13", "2026-04-14", { by: HEAD_OF_HR });
    expect((await steps(r.id)).filter((s) => s.status !== "skipped")).toEqual([{ name: "HR", status: "pending" }]);
    await h.commitAs(hrPerson.staffId!, () => db.query("select approve_leave_step($1)", [r.id]));
    expect(await status(r.id)).toBe("approved");
  });
});

describe("rules on requests", () => {
  it("counts pending requests against the balance, so the same days can't be asked for twice", async () => {
    const someone = await h.employee({ branch: lagos, title: "Accountant", login: true, hired: "2021-01-04" });
    await recordLeave(someone.id, annual, "2026-05-04", "2026-05-08"); // 5 of 10, pending
    await recordLeave(someone.id, annual, "2026-05-11", "2026-05-15"); // the other 5, pending
    await expect(recordLeave(someone.id, annual, "2026-06-01", "2026-06-01")).rejects.toThrow(/only 0 days of annual leave are left/);
  });

  it("refuses overlapping dates until the first request is cancelled", async () => {
    const someone = await h.employee({ branch: lagos, title: "Accountant", login: true });
    const first = await recordLeave(someone.id, unpaid, "2026-07-06", "2026-07-10");
    await expect(recordLeave(someone.id, unpaid, "2026-07-08", "2026-07-09")).rejects.toThrow(/overlap/);
    await h.commitAs(someone.staffId!, () => db.query("select cancel_leave_request($1, 'Plans changed')", [first.id]));
    expect(await status(first.id)).toBe("cancelled");
    await recordLeave(someone.id, unpaid, "2026-07-08", "2026-07-09");
  });

  it("asks for a medical certificate for more than three days' sick leave", async () => {
    await expect(recordLeave(bystander.id, sick, "2026-02-02", "2026-02-05")).rejects.toThrow(/attach a supporting document/);
    await recordLeave(bystander.id, sick, "2026-02-02", "2026-02-04");
  });

  it("won't let an employee start leave in the past; HR records that", async () => {
    await expect(
      h.commitAs(requester.staffId!, () =>
        db.query("select request_leave($1, '2020-01-06', '2020-01-07', 'Old leave')", [unpaid]),
      ),
    ).rejects.toThrow(/can't start in the past/);
  });

  it("ends the request at the first rejection", async () => {
    const r = await recordLeave(requester.id, unpaid, "2026-08-03", "2026-08-04");
    await expect(h.commitAs(supervisor.staffId!, () => db.query("select reject_leave_step($1, '')", [r.id]))).rejects.toThrow(
      /say why/,
    );
    await h.commitAs(supervisor.staffId!, () => db.query("select reject_leave_step($1, 'Month-end close')", [r.id]));
    expect(await status(r.id)).toBe("rejected");
    expect((await steps(r.id)).map((s) => s.status)).toEqual(["rejected", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("lets the Head of HR decide outright, with a reason, but not on their own leave", async () => {
    const r = await recordLeave(requester.id, unpaid, "2026-09-07", "2026-09-08");
    await h.commitAs(HEAD_OF_HR, () => db.query("select decide_leave_request($1, true, 'Urgent family matter')", [r.id]));
    expect(await status(r.id)).toBe("approved");
    await expect(
      h.commitAs(HR_OFFICER, () => db.query("select decide_leave_request($1, false, 'No')", [r.id])),
    ).rejects.toThrow(/leave request not found/);
  });

  it("only changes through the workflow functions", async () => {
    const r = await recordLeave(requester.id, unpaid, "2026-10-05", "2026-10-05");
    const changed = await h.commitAs(HEAD_OF_HR, () => db.query("update leave_requests set days = 1 where id = $1 returning id", [r.id]));
    expect(changed.rows).toHaveLength(0);
  });
});
