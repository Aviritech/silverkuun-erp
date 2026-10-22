import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";
import { people, twoBranches } from "./people";

let db: PGlite;
let h: ReturnType<typeof people>;
let lagos: string;
let abuja: string;

const HR_OFFICER = crypto.randomUUID();

type Person = { id: string; staffId: string | null };
let ada: Person; // Lagos account officer with a login
let bola: Person; // Abuja account officer with a login
let manager: Person; // Lagos branch manager, reviews Lagos staff

beforeAll(async () => {
  db = await createTestDatabase();
  h = people(db);
  ({ lagos, abuja } = await twoBranches(db));
  await h.addStaff(HR_OFFICER, "hr", "hr_officer", lagos);
  ada = await h.employee({ branch: lagos, title: "Account Officer", department: "credit", login: true });
  bola = await h.employee({ branch: abuja, title: "Account Officer", department: "credit", login: true });
  manager = await h.employee({ branch: lagos, title: "Branch Manager", login: true, role: "branch_manager", roleBranch: lagos });
});

describe("people a reviewer can choose", () => {
  it("lists names in the branches the reviewer covers, without HR file access", async () => {
    // A branch manager has no hr.read, so the employee records themselves stay hidden.
    const records = await h.commitAs(manager.staffId!, () => db.query("select id from employees where id = $1", [ada.id]));
    expect(records.rows).toHaveLength(0);

    const { rows } = await h.commitAs(manager.staffId!, () =>
      db.query<{ id: string; is_me: boolean }>("select id, is_me from performance_people()"),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ada.id);
    expect(ids).not.toContain(bola.id);
    expect(rows.find((r) => r.id === manager.id)?.is_me).toBe(true);
  });

  it("gives ordinary staff nobody", async () => {
    const { rows } = await h.commitAs(ada.staffId!, () => db.query("select id from performance_people()"));
    expect(rows).toHaveLength(0);
  });
});

describe("closed goals", () => {
  it("can't be reopened or cancelled once completed", async () => {
    const goal = (
      await h.commitAs(manager.staffId!, () =>
        db.query<{ id: string }>("insert into employee_goals (employee_id, title) values ($1, 'Clear arrears') returning id", [ada.id]),
      )
    ).rows[0].id;
    await h.commitAs(ada.staffId!, () => db.query("select update_goal_progress($1, 100)", [goal]));
    await expect(
      h.commitAs(manager.staffId!, () => db.query("update employee_goals set status = 'cancelled' where id = $1", [goal])),
    ).rejects.toThrow(/this goal is closed/);
  });

  it("can't be reopened once cancelled", async () => {
    const goal = (
      await h.commitAs(manager.staffId!, () =>
        db.query<{ id: string }>("insert into employee_goals (employee_id, title) values ($1, 'Open a new market') returning id", [ada.id]),
      )
    ).rows[0].id;
    await h.commitAs(manager.staffId!, () => db.query("update employee_goals set status = 'cancelled' where id = $1", [goal]));
    await expect(
      h.commitAs(manager.staffId!, () => db.query("update employee_goals set status = 'open' where id = $1", [goal])),
    ).rejects.toThrow(/this goal is closed/);
  });
});

describe("training places", () => {
  it("are counted for everyone, without showing who enrolled", async () => {
    const training = (
      await h.commitAs(HR_OFFICER, () =>
        db.query<{ id: string }>(
          "insert into trainings (title, starts_on, ends_on, capacity) values ('Customer care', current_date + 5, current_date + 5, 10) returning id",
        ),
      )
    ).rows[0].id;
    await h.commitAs(ada.staffId!, () => db.query("select enrol_in_training($1)", [training]));
    const mine = await h.commitAs(ada.staffId!, () => db.query<{ id: string }>("select id from training_enrollments where training_id = $1", [training]));
    await h.commitAs(manager.staffId!, () => db.query("select enrol_in_training($1)", [training]));

    const visible = await h.commitAs(bola.staffId!, () => db.query("select id from training_enrollments where training_id = $1", [training]));
    expect(visible.rows).toHaveLength(0);
    const seats = await h.commitAs(bola.staffId!, () =>
      db.query<{ taken: number }>("select taken from training_seats_taken(array[$1]::uuid[])", [training]),
    );
    expect(seats.rows[0].taken).toBe(2);

    await h.commitAs(ada.staffId!, () => db.query("select withdraw_from_training($1)", [mine.rows[0].id]));
    const after = await h.commitAs(bola.staffId!, () =>
      db.query<{ taken: number }>("select taken from training_seats_taken(array[$1]::uuid[])", [training]),
    );
    expect(after.rows[0].taken).toBe(1);
  });
});
