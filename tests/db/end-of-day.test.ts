import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const ACCOUNTANT = "00000000-0000-0000-0000-0000000000e1";
const CONTROLLER = "00000000-0000-0000-0000-0000000000f1";
const DAY_END = "00000000-0000-0000-0000-0000000000f2";
const AUDITOR = "00000000-0000-0000-0000-0000000000d1";
const OFFICER = "00000000-0000-0000-0000-0000000000a1";

let db: PGlite;
let lagos: string;
let abuja: string;

async function addStaff(id: string, department: string, role: string, branchId: string | null) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@kuun.test`]);
  await db.query("insert into staff (id, full_name, email, department_code) values ($1::uuid, $1::text, $2, $3)", [
    id,
    `${id}@kuun.test`,
    department,
  ]);
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

/** A manual journal prepared by the accountant, on a date, for a branch; returns its id. */
async function prepare(date: string, lines: [string, number, number][], branch = lagos): Promise<string> {
  const id = (
    await commitAs(ACCOUNTANT, () =>
      db.query<{ id: string }>("insert into journal_entries (branch_id, entry_date, description) values ($1, $2, 'Manual') returning id", [
        branch,
        date,
      ]),
    )
  ).rows[0].id;
  for (const [i, [account, debit, credit]] of lines.entries()) {
    await commitAs(ACCOUNTANT, () =>
      db.query("insert into journal_lines (entry_id, line_no, branch_id, account_code, debit, credit) values ($1, $2, $3, $4, $5, $6)", [
        id,
        i,
        branch,
        account,
        debit,
        credit,
      ]),
    );
  }
  return id;
}

const post = (id: string) => commitAs(CONTROLLER, () => db.query("select post_journal_entry($1)", [id]));
const closeDay = (by = CONTROLLER, note: string | null = null) =>
  commitAs(by, () => db.query<{ business_date: string; status: string; report: Record<string, any> }>(
    "select business_date::text, status, report from run_end_of_day($1)",
    [note],
  )).then((r) => r.rows[0]);
const openDay = async () =>
  (await db.query<{ d: string }>("select business_date::text as d from business_days where status = 'open'")).rows[0]?.d;
const entryDate = async (id: string) =>
  (await db.query<{ d: string }>("select entry_date::text as d from journal_entries where id = $1", [id])).rows[0].d;

/** Starts the business calendar again with only `date` open, as if the system went live that day. */
async function startOn(date: string) {
  await db.exec("delete from period_closes; delete from business_days;");
  await db.query("insert into business_days (business_date, status) values ($1, 'open')", [date]);
}

beforeAll(async () => {
  db = await createTestDatabase();
  const region = await db.query<{ id: string }>("insert into regions (code, name) values ('SW', 'South West') returning id");
  lagos = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'LAG', 'Lagos') returning id", [region.rows[0].id]))
    .rows[0].id;
  abuja = (await db.query<{ id: string }>("insert into branches (region_id, code, name) values ($1, 'ABJ', 'Abuja') returning id", [region.rows[0].id]))
    .rows[0].id;
  await addStaff(ACCOUNTANT, "accounts", "regional_accountant", null);
  await addStaff(CONTROLLER, "accounts", "financial_controller", null);
  await addStaff(DAY_END, "accounts", "day_end_officer", null);
  await addStaff(AUDITOR, "internal_audit", "internal_auditor", null);
  await addStaff(OFFICER, "administration", "admin_officer", lagos);
  await db.exec(`
    insert into ledger_accounts (code, name, account_type, parent_code, cash_flow_class) values ('1131', 'Lagos bank', 'asset', '1130', 'cash');
  `);
  await db.query("insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Lagos', '1131')", [lagos]);
});

describe("business date", () => {
  it("starts on the day the system goes live, and every staff member can see it", async () => {
    const today = (await db.query<{ d: string }>("select current_date::text as d")).rows[0].d;
    expect(await openDay()).toBe(today);
    const status = await asUser(db, OFFICER, (tx) =>
      tx.query<{ business_date: string; last_closed: string | null; auto_close: boolean }>(
        "select business_date::text, last_closed, auto_close from business_date_status()",
      ),
    );
    expect(status.rows[0]).toEqual({ business_date: today, last_closed: null, auto_close: true });
  });

  it("is closed only by the Financial Controller or an End of Day Officer, and nobody edits it directly", async () => {
    await expect(closeDay(ACCOUNTANT)).rejects.toThrow(/only the Financial Controller or an End of Day Officer/);
    await expect(closeDay(OFFICER)).rejects.toThrow(/only the Financial Controller/);
    const edit = await asUser(db, CONTROLLER, (tx) => tx.query("update business_days set status = 'closed'").catch((e: Error) => e));
    expect(String(edit)).toMatch(/permission denied/);
    // Office staff without accounts access see the date in the header but not the reports.
    const rows = await asUser(db, OFFICER, (tx) => tx.query("select * from business_days"));
    expect(rows.rows).toHaveLength(0);
    const auditor = await asUser(db, AUDITOR, (tx) => tx.query("select * from business_days"));
    expect(auditor.rows).toHaveLength(1);
  });

  it("can't close a day that hasn't started", async () => {
    await startOn("2099-01-01");
    await expect(closeDay()).rejects.toThrow(/hasn't started yet/);
  });
});

describe("End of Day", () => {
  it("closes the day with a report, opens the next, and locks the closed day", async () => {
    await startOn("2025-12-30");
    const income = await prepare("2025-12-30", [
      ["1131", 1000, 0],
      ["4400", 0, 1000],
    ]);
    const expense = await prepare("2025-12-30", [
      ["5800", 300, 0],
      ["1131", 0, 300],
    ]);
    const mistake = await prepare("2025-12-30", [
      ["5300", 50, 0],
      ["1131", 0, 50],
    ]);
    await post(income);
    await post(expense);
    await post(mistake);
    const leftInDraft = await prepare("2025-12-30", [
      ["5300", 10, 0],
      ["1131", 0, 10],
    ]);

    const closed = await closeDay(DAY_END, "All branches balanced");
    expect(closed.business_date).toBe("2025-12-30");
    expect(closed.status).toBe("closed");
    expect(closed.report).toMatchObject({
      ledger: { entries: 3, debits: 1350, credits: 1350 },
      cash: { opening: 0, money_in: 1000, money_out: 350, closing: 650 },
      profit_and_loss: { income: 1000, expenses: 350, surplus: 650 },
      unfinished: { journals_draft: 1 },
    });
    expect(closed.report.by_branch).toEqual([
      { branch: "Lagos", entries: 3, debits: 1350, money_in: 1000, money_out: 350, surplus: 650 },
    ]);
    expect(await openDay()).toBe("2025-12-31");
    const row = (await db.query<{ closed_by: string; close_mode: string; note: string }>(
      "select closed_by, close_mode, note from business_days where business_date = '2025-12-30'",
    )).rows[0];
    expect(row).toEqual({ closed_by: DAY_END, close_mode: "manual", note: "All branches balanced" });

    // A manual journal can't be posted into the closed day; it must be re-dated.
    await expect(post(leftInDraft)).rejects.toThrow(/closed up to 30 Dec 2025.*date it 31 Dec 2025 or later/);
    await commitAs(ACCOUNTANT, () => db.query("update journal_entries set entry_date = '2025-12-31' where id = $1", [leftInDraft]));
    await post(leftInDraft);

    // A correction to the closed day is a reversal, and it lands on the open day.
    await commitAs(CONTROLLER, () => db.query("select reverse_journal_entry($1, 'Wrong account', '2025-12-30')", [mistake]));
    const reversal = (await db.query<{ id: string }>("select reversed_by_entry_id as id from journal_entries where id = $1", [mistake])).rows[0].id;
    expect(await entryDate(reversal)).toBe("2025-12-31");
    expect(await entryDate(mistake)).toBe("2025-12-30");
  });

  it("at the end of December closes the month and the year, moving the surplus into accumulated funds", async () => {
    await post(
      await prepare("2025-12-31", [
        ["1131", 500, 0],
        ["4300", 0, 500],
      ], lagos),
    );
    // Abuja made a loss.
    await post(
      await prepare("2025-12-31", [
        ["5300", 200, 0],
        ["1131", 0, 200],
      ], abuja),
    );
    const closed = await closeDay();
    expect(closed.business_date).toBe("2025-12-31");
    expect(await openDay()).toBe("2026-01-01");

    const closes = (await db.query<{ period_kind: string; period_start: string; period_end: string; report: Record<string, any>; n: number }>(
      "select period_kind, period_start::text, period_end::text, report, cardinality(closing_entry_ids) as n from period_closes order by period_kind",
    )).rows;
    expect(closes.map((c) => [c.period_kind, c.period_start, c.period_end, c.n])).toEqual([
      ["month", "2025-12-01", "2025-12-31", 0],
      ["year", "2025-01-01", "2025-12-31", 2],
    ]);
    // Income 1500; expenses 300 + 50 - 50 (reversed) + 10 + 200 = 510.
    for (const c of closes) expect(c.report.profit_and_loss).toEqual({ income: 1500, expenses: 510, surplus: 990 });
    expect(closes[0].report.days_closed).toBe(2);

    // Income and expenses are nil after the close; the surplus is in 3200 per branch.
    const balances = (await db.query<{ code: string; branch: string; balance: string }>(
      `select l.account_code as code, b.code as branch, sum(l.credit - l.debit)::text as balance
       from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join branches b on b.id = l.branch_id
       where l.account_code ~ '^[345]' group by 1, 2 having sum(l.credit - l.debit) <> 0 order by 1, 2`,
    )).rows;
    expect(balances).toEqual([
      { code: "3200", branch: "ABJ", balance: "-200.00" },
      { code: "3200", branch: "LAG", balance: "1190.00" },
    ]);

    // The year's profit and loss still shows what was earned, and the ledger still balances.
    const pl = (await db.query<{ code: string; debit: string; credit: string; closing: string }>(
      "select code, debit::text, credit::text, closing::text from account_balances('2025-01-01', '2025-12-31') where code in ('4300', '4400', '3200')",
    )).rows;
    expect(pl).toEqual([
      { code: "3200", debit: "200.00", credit: "1190.00", closing: "-990.00" },
      { code: "4300", debit: "0.00", credit: "500.00", closing: "0.00" },
      { code: "4400", debit: "0.00", credit: "1000.00", closing: "0.00" },
    ]);
    const tb = (await db.query<{ dr: string; cr: string }>(
      "select sum(debit)::text as dr, sum(credit)::text as cr from journal_lines",
    )).rows[0];
    expect(tb.dr).toBe(tb.cr);

    // The year is locked.
    await expect(post(await prepare("2025-06-30", [["5800", 1, 0], ["1131", 0, 1]]))).rejects.toThrow(/closed up to 31 Dec 2025/);
  });

  it("closes a month that isn't December without touching income and expenses", async () => {
    await startOn("2026-01-31");
    await post(await prepare("2026-01-31", [["1131", 70, 0], ["4400", 0, 70]]));
    await closeDay();
    const month = (await db.query<{ report: Record<string, any> }>("select report from period_closes where period_end = '2026-01-31'")).rows[0];
    expect(month.report.profit_and_loss).toEqual({ income: 70, expenses: 0, surplus: 70 });
    expect((await db.query("select 1 from period_closes where period_kind = 'year'")).rows).toHaveLength(0);
    expect(await openDay()).toBe("2026-02-01");
  });
});

describe("automatic close", () => {
  it("catches up on earlier days, leaves today until the set time, and can be turned off", async () => {
    const today = (await db.query<{ d: string }>("select current_date::text as d")).rows[0].d;
    const lagosNow = (await db.query<{ t: string }>("select to_char(now() at time zone 'Africa/Lagos', 'HH24:MI') as t")).rows[0].t;
    await startOn((await db.query<{ d: string }>("select (current_date - 2)::text as d")).rows[0].d);

    await expect(
      commitAs(ACCOUNTANT, () => db.query("select set_day_end_settings(true, '23:59')")),
    ).rejects.toThrow(/only the Financial Controller/);
    // Late enough that today stays open, unless the test happens to run in the last minute of the day in Lagos.
    await commitAs(CONTROLLER, () => db.query("select set_day_end_settings(true, '23:59')"));
    const closedCount = (await db.query<{ n: number }>("select app.auto_end_of_day() as n")).rows[0].n;
    if (lagosNow < "23:59") {
      expect(closedCount).toBe(2);
      expect(await openDay()).toBe(today);
    }
    const modes = (await db.query<{ close_mode: string; closed_by: string | null }>(
      "select close_mode, closed_by from business_days where status = 'closed'",
    )).rows;
    expect(modes.every((m) => m.close_mode === "automatic" && m.closed_by === null)).toBe(true);

    await startOn((await db.query<{ d: string }>("select (current_date - 1)::text as d")).rows[0].d);
    await commitAs(CONTROLLER, () => db.query("select set_day_end_settings(false, '23:00')"));
    expect((await db.query<{ n: number }>("select app.auto_end_of_day() as n")).rows[0].n).toBe(0);
    await expect(commitAs(CONTROLLER, () => db.query("select app.auto_end_of_day()"))).rejects.toThrow(/permission denied/);
  });
});
