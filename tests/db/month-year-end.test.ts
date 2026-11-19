import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";

const ACCOUNTANT = "00000000-0000-0000-0000-0000000000e1";
const CONTROLLER = "00000000-0000-0000-0000-0000000000f1";
const MONTH_END = "00000000-0000-0000-0000-0000000000f2";
const AUDITOR = "00000000-0000-0000-0000-0000000000d1";
const OFFICER = "00000000-0000-0000-0000-0000000000a1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- report JSON is checked field by field below
type Report = Record<string, any>;
type Close = { period_kind: string; period_start: string; period_end: string; report: Report; n: number };

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
const closeMonth = (monthEnd: string, by = CONTROLLER, note: string | null = null) =>
  commitAs(by, () =>
    db.query<{ period_end: string; report: Report }>("select period_end::text, report from run_month_end($1, $2)", [monthEnd, note]),
  ).then((r) => r.rows[0]);
const next = async () =>
  (await db.query<{ period_end: string; closed_through: string | null }>(
    "select period_end::text, closed_through::text from next_month_to_close()",
  )).rows[0];
const entryDate = async (id: string) =>
  (await db.query<{ d: string }>("select entry_date::text as d from journal_entries where id = $1", [id])).rows[0].d;

/** Starts the closing history again, as if every month up to `through` had been closed. */
async function closedThrough(through: string | null) {
  await db.exec("delete from period_closes");
  if (through) {
    await db.query(
      "insert into period_closes (period_kind, period_start, period_end, closed_by, report) values ('month', date_trunc('month', $1::date), $1, $2, '{}')",
      [through, CONTROLLER],
    );
  }
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
  await addStaff(MONTH_END, "accounts", "month_end_officer", null);
  await addStaff(AUDITOR, "internal_audit", "internal_auditor", null);
  await addStaff(OFFICER, "administration", "admin_officer", lagos);
  await db.exec(`
    insert into ledger_accounts (code, name, account_type, parent_code, cash_flow_class) values ('1131', 'Lagos bank', 'asset', '1130', 'cash');
  `);
  await db.query("insert into bank_accounts (branch_id, name, ledger_account_code) values ($1, 'Lagos', '1131')", [lagos]);
});

describe("month to close", () => {
  it("is last month until one has closed", async () => {
    const lastMonthEnd = (await db.query<{ d: string }>(
      "select (date_trunc('month', (now() at time zone 'Africa/Lagos')::date) - interval '1 day')::date::text as d",
    )).rows[0].d;
    expect(await next()).toEqual({ period_end: lastMonthEnd, closed_through: null });
  });

  it("is closed only by the Financial Controller or a Month-end Officer, and nobody edits closes directly", async () => {
    const { period_end } = await next();
    await expect(closeMonth(period_end, ACCOUNTANT)).rejects.toThrow(/only the Financial Controller or a Month-end Officer/);
    await expect(closeMonth(period_end, OFFICER)).rejects.toThrow(/only the Financial Controller/);
    const edit = await asUser(db, CONTROLLER, (tx) =>
      tx.query("insert into period_closes (period_kind, period_start, period_end, closed_by, report) values ('month', '2020-01-01', '2020-01-31', $1, '{}')", [
        CONTROLLER,
      ]).catch((e: Error) => e),
    );
    expect(String(edit)).toMatch(/permission denied/);
  });

  it("must be the next month, and one that has ended", async () => {
    await closedThrough("2025-10-31");
    await expect(closeMonth("2025-12-31")).rejects.toThrow(/next month to close is the one ending 30 Nov 2025/);
    const thisMonthEnd = (await db.query<{ d: string }>(
      "select (date_trunc('month', (now() at time zone 'Africa/Lagos')::date) + interval '1 month - 1 day')::date::text as d",
    )).rows[0].d;
    await closedThrough(
      (await db.query<{ d: string }>("select (date_trunc('month', (now() at time zone 'Africa/Lagos')::date) - interval '1 day')::date::text as d")).rows[0].d,
    );
    await expect(closeMonth(thisMonthEnd)).rejects.toThrow(/hasn't ended yet/);
  });
});

describe("End of Month", () => {
  it("saves the month report, locks the month and moves the next close on", async () => {
    await closedThrough("2025-10-31");
    const income = await prepare("2025-11-03", [
      ["1131", 1000, 0],
      ["4400", 0, 1000],
    ]);
    const expense = await prepare("2025-11-20", [
      ["5800", 300, 0],
      ["1131", 0, 300],
    ]);
    const mistake = await prepare("2025-11-28", [
      ["5300", 50, 0],
      ["1131", 0, 50],
    ]);
    await post(income);
    await post(expense);
    await post(mistake);
    const leftInDraft = await prepare("2025-11-30", [
      ["5300", 10, 0],
      ["1131", 0, 10],
    ]);

    const closed = await closeMonth("2025-11-30", MONTH_END, "Bank reconciled");
    expect(closed.period_end).toBe("2025-11-30");
    expect(closed.report).toMatchObject({
      ledger: { entries: 3, debits: 1350, credits: 1350 },
      cash: { opening: 0, money_in: 1000, money_out: 350, closing: 650 },
      profit_and_loss: { income: 1000, expenses: 350, surplus: 650 },
      unfinished: { journals_draft: 1 },
    });
    expect(closed.report.by_branch).toEqual([{ branch: "Lagos", entries: 3, debits: 1350, money_in: 1000, money_out: 350, surplus: 650 }]);
    expect(await next()).toEqual({ period_end: "2025-12-31", closed_through: "2025-11-30" });
    const row = (await db.query<{ closed_by: string; note: string }>("select closed_by, note from period_closes where period_end = '2025-11-30'")).rows[0];
    expect(row).toEqual({ closed_by: MONTH_END, note: "Bank reconciled" });

    // A manual journal can't be posted into the closed month; it must be re-dated.
    await expect(post(leftInDraft)).rejects.toThrow(/closed up to 30 Nov 2025.*date it 1 Dec 2025 or later/);
    await commitAs(ACCOUNTANT, () => db.query("update journal_entries set entry_date = '2025-12-01' where id = $1", [leftInDraft]));
    await post(leftInDraft);

    // A correction to the closed month is a reversal, and it lands in the open month.
    await commitAs(CONTROLLER, () => db.query("select reverse_journal_entry($1, 'Wrong account', '2025-11-28')", [mistake]));
    const reversal = (await db.query<{ id: string }>("select reversed_by_entry_id as id from journal_entries where id = $1", [mistake])).rows[0].id;
    expect(await entryDate(reversal)).toBe("2025-12-01");
    expect(await entryDate(mistake)).toBe("2025-11-28");

    // The same month can't close twice.
    await expect(closeMonth("2025-11-30")).rejects.toThrow(/next month to close is the one ending 31 Dec 2025/);
  });

  it("in December also closes the year, moving the surplus into accumulated funds", async () => {
    await post(await prepare("2025-12-31", [["1131", 500, 0], ["4300", 0, 500]], lagos));
    // Abuja made a loss.
    await post(await prepare("2025-12-15", [["5300", 200, 0], ["1131", 0, 200]], abuja));
    await closeMonth("2025-12-31");
    expect((await next()).period_end).toBe("2026-01-31");

    const closes = (await db.query<Close>(
      `select period_kind, period_start::text, period_end::text, report, cardinality(closing_entry_ids) as n
       from period_closes where period_end = '2025-12-31' order by period_kind`,
    )).rows;
    expect(closes.map((c) => [c.period_kind, c.period_start, c.period_end, c.n])).toEqual([
      ["month", "2025-12-01", "2025-12-31", 0],
      ["year", "2025-01-01", "2025-12-31", 2],
    ]);
    // December: income 500; expenses 10 + 200 - 50 (reversal) = 160.
    expect(closes[0].report.profit_and_loss).toEqual({ income: 500, expenses: 160, surplus: 340 });
    // The year: income 1500; expenses 300 + 50 - 50 + 10 + 200 = 510.
    expect(closes[1].report.profit_and_loss).toEqual({ income: 1500, expenses: 510, surplus: 990 });

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
    const tb = (await db.query<{ dr: string; cr: string }>("select sum(debit)::text as dr, sum(credit)::text as cr from journal_lines")).rows[0];
    expect(tb.dr).toBe(tb.cr);

    // The year is locked.
    await expect(post(await prepare("2025-06-30", [["5800", 1, 0], ["1131", 0, 1]]))).rejects.toThrow(/closed up to 31 Dec 2025/);
  });

  it("is readable by Accounts and Internal Audit, not other staff", async () => {
    expect((await asUser(db, AUDITOR, (tx) => tx.query("select * from period_closes"))).rows.length).toBeGreaterThan(0);
    expect((await asUser(db, OFFICER, (tx) => tx.query("select * from period_closes"))).rows).toHaveLength(0);
    await expect(asUser(db, OFFICER, (tx) => tx.query("select month_end_preview()"))).rejects.toThrow(/not allowed/);
    const preview = await asUser(db, AUDITOR, (tx) => tx.query<{ p: Report }>("select month_end_preview() as p"));
    expect(preview.rows[0].p).toMatchObject({ from: "2026-01-01", to: "2026-01-31", unfinished: { journals_draft: 1 } }); // the refused June entry
  });
});
