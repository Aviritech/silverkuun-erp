import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";
import type { ReportDefinition, ReportFilters, Row } from "@/lib/reports/types";
import { FINANCE_STATUSES } from "./constants";

type Balance = {
  code: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "income" | "expense";
  cash_flow_class: string;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
};

const EARLIEST = "1900-01-01";
const n = (v: string | number | null | undefined) => Number(v ?? 0);
const round = (v: number) => Math.round(v * 100) / 100;

async function balances(supabase: SupabaseClient, from: string, to: string, f: ReportFilters): Promise<Balance[]> {
  const { data, error } = await supabase.rpc("account_balances", {
    p_from: from,
    p_to: to,
    p_branch_id: f.branch,
    p_region_id: f.region,
  });
  if (error) throw dbFailure(error);
  return data as Balance[];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The period of the same length immediately before [from, to]. */
function previousPeriod(from: string, to: string): [string, string] {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  const prevTo = addDays(from, -1);
  return [addDays(prevTo, -days), prevTo];
}

async function staffNames(supabase: SupabaseClient, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const { data } = await supabase.rpc("staff_display_names", { p_ids: unique });
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
}

const trialBalance: ReportDefinition = {
  key: "trial-balance",
  title: "Trial balance",
  description: "Opening balance, debits, credits and closing balance for every account with activity.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "period",
  branchFilter: true,
  async run(supabase, f) {
    const rows: Row[] = [];
    let dr = 0;
    let cr = 0;
    for (const b of await balances(supabase, f.from, f.to, f)) {
      if (!n(b.opening) && !n(b.debit) && !n(b.credit) && !n(b.closing)) continue;
      const closing = n(b.closing);
      dr += closing > 0 ? closing : 0;
      cr += closing < 0 ? -closing : 0;
      rows.push({
        code: b.code,
        name: b.name,
        opening: b.opening,
        debit: b.debit,
        credit: b.credit,
        closing_dr: closing > 0 ? closing : null,
        closing_cr: closing < 0 ? -closing : null,
        _href: `/accounts/reports/general-ledger?from=${f.from}&to=${f.to}&account=${b.code}`,
      });
    }
    rows.push({ code: "", name: "Total", closing_dr: round(dr), closing_cr: round(cr), _kind: "total" });
    return {
      columns: [
        { key: "code", label: "Code" },
        { key: "name", label: "Account" },
        { key: "opening", label: "Opening (Dr +)", kind: "money" },
        { key: "debit", label: "Debits", kind: "money" },
        { key: "credit", label: "Credits", kind: "money" },
        { key: "closing_dr", label: "Closing Dr", kind: "money" },
        { key: "closing_cr", label: "Closing Cr", kind: "money" },
      ],
      rows,
      notes: [round(dr) === round(cr) ? "Debits equal credits." : `Out of balance by ${round(dr - cr)}.`],
    };
  },
};

const profitAndLoss: ReportDefinition = {
  key: "profit-and-loss",
  title: "Profit and loss",
  description: "Income and expenses for the period, the period before it, and the year to date.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "period",
  branchFilter: true,
  async run(supabase, f) {
    const [prevFrom, prevTo] = previousPeriod(f.from, f.to);
    const [current, previous, ytd] = await Promise.all([
      balances(supabase, f.from, f.to, f),
      balances(supabase, prevFrom, prevTo, f),
      balances(supabase, `${f.to.slice(0, 4)}-01-01`, f.to, f),
    ]);
    const movement = (list: Balance[], code: string, sign: number) => {
      const b = list.find((x) => x.code === code)!;
      return round(sign * (n(b.debit) - n(b.credit)));
    };
    const rows: Row[] = [];
    const totals = { current: 0, previous: 0, ytd: 0 };
    const section = (type: "income" | "expense", title: string) => {
      const sign = type === "income" ? -1 : 1;
      const sub = { current: 0, previous: 0, ytd: 0 };
      rows.push({ name: title, _kind: "heading" });
      for (const b of current.filter((x) => x.account_type === type)) {
        const row = { current: movement(current, b.code, sign), previous: movement(previous, b.code, sign), ytd: movement(ytd, b.code, sign) };
        if (!row.current && !row.previous && !row.ytd) continue;
        sub.current += row.current;
        sub.previous += row.previous;
        sub.ytd += row.ytd;
        rows.push({ name: `${b.code} ${b.name}`, ...row });
      }
      rows.push({ name: `Total ${title.toLowerCase()}`, current: round(sub.current), previous: round(sub.previous), ytd: round(sub.ytd), _kind: "subtotal" });
      const direction = type === "income" ? 1 : -1;
      totals.current += direction * sub.current;
      totals.previous += direction * sub.previous;
      totals.ytd += direction * sub.ytd;
    };
    section("income", "Income");
    section("expense", "Expenses");
    rows.push({ name: "Surplus / (deficit)", current: round(totals.current), previous: round(totals.previous), ytd: round(totals.ytd), _kind: "total" });
    return {
      columns: [
        { key: "name", label: "Account" },
        { key: "current", label: `${f.from} to ${f.to}`, kind: "money" },
        { key: "previous", label: `${prevFrom} to ${prevTo}`, kind: "money" },
        { key: "ytd", label: "Year to date", kind: "money" },
      ],
      rows,
    };
  },
};

const balanceSheet: ReportDefinition = {
  key: "balance-sheet",
  title: "Statement of financial position",
  description: "Assets, liabilities and accumulated funds as at a date, straight from the ledger.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "asAt",
  branchFilter: true,
  async run(supabase, f) {
    const list = await balances(supabase, EARLIEST, f.to, f);
    const rows: Row[] = [];
    const section = (type: Balance["account_type"], title: string, sign: number) => {
      rows.push({ name: title, _kind: "heading" });
      let total = 0;
      for (const b of list.filter((x) => x.account_type === type)) {
        const amount = round(sign * n(b.closing));
        if (!amount) continue;
        total += amount;
        rows.push({ name: `${b.code} ${b.name}`, amount });
      }
      return total;
    };
    const assets = section("asset", "Assets", 1);
    rows.push({ name: "Total assets", amount: round(assets), _kind: "subtotal" });
    const liabilities = section("liability", "Liabilities", -1);
    rows.push({ name: "Total liabilities", amount: round(liabilities), _kind: "subtotal" });
    let equity = section("equity", "Accumulated funds", -1);
    const unclosed = round(-list.filter((b) => b.account_type === "income" || b.account_type === "expense").reduce((s, b) => s + n(b.closing), 0));
    if (unclosed) {
      rows.push({ name: "Surplus / (deficit) not yet closed to accumulated funds", amount: unclosed });
      equity += unclosed;
    }
    rows.push({ name: "Total accumulated funds", amount: round(equity), _kind: "subtotal" });
    rows.push({ name: "Total liabilities and accumulated funds", amount: round(liabilities + equity), _kind: "total" });
    const difference = round(assets - liabilities - equity);
    return {
      columns: [
        { key: "name", label: "" },
        { key: "amount", label: `As at ${f.to}`, kind: "money" },
      ],
      rows,
      notes: [difference === 0 ? "Assets equal liabilities plus accumulated funds." : `Does not balance: difference ${difference}.`],
    };
  },
};

const CASH_FLOW_TITLES: Record<string, string> = {
  operating: "Operating activities",
  investing: "Investing activities",
  financing: "Financing activities",
};

const cashFlow: ReportDefinition = {
  key: "cash-flow",
  title: "Cash flow",
  description: "Cash and bank movements for the period, grouped by what they were for (direct method).",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "period",
  branchFilter: true,
  async run(supabase, f) {
    const [{ data, error }, opening] = await Promise.all([
      supabase.rpc("cash_flow", { p_from: f.from, p_to: f.to, p_branch_id: f.branch, p_region_id: f.region }),
      balances(supabase, f.from, f.to, f),
    ]);
    if (error) throw dbFailure(error);
    const flows = data as { cash_flow_class: string; account_code: string; account_name: string; amount: string }[];
    const cash = opening.filter((b) => b.cash_flow_class === "cash");
    const openingCash = round(cash.reduce((s, b) => s + n(b.opening), 0));
    const closingCash = round(cash.reduce((s, b) => s + n(b.closing), 0));

    const rows: Row[] = [{ name: "Cash and bank at start", amount: openingCash, _kind: "subtotal" }];
    let net = 0;
    for (const cls of ["operating", "investing", "financing"]) {
      const lines = flows.filter((x) => x.cash_flow_class === cls);
      rows.push({ name: CASH_FLOW_TITLES[cls], _kind: "heading" });
      const total = round(lines.reduce((s, x) => s + n(x.amount), 0));
      for (const x of lines) rows.push({ name: `${x.account_code} ${x.account_name}`, amount: x.amount });
      rows.push({ name: `Net cash from ${CASH_FLOW_TITLES[cls].toLowerCase()}`, amount: total, _kind: "subtotal" });
      net += total;
    }
    rows.push({ name: "Net change in cash and bank", amount: round(net), _kind: "subtotal" });
    rows.push({ name: "Cash and bank at end", amount: closingCash, _kind: "total" });
    return {
      columns: [
        { key: "name", label: "" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows,
      notes: [
        round(openingCash + net) === closingCash
          ? "Opening cash plus the net change agrees to closing cash."
          : `Opening cash plus the net change differs from closing cash by ${round(closingCash - openingCash - net)}.`,
        "Classifications follow each account's cash flow setting in the chart of accounts; confirm them with the Society's accountant.",
      ],
    };
  },
};

const ACCOUNT_GROUPS = [
  { value: "all", label: "All accounts" },
  { value: "asset", label: "Assets" },
  { value: "liability", label: "Liabilities" },
  { value: "equity", label: "Accumulated funds" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expenses" },
];

type LedgerLine = {
  account_code: string;
  debit: string;
  credit: string;
  description: string | null;
  branch_id: string;
  journal_entries: { id: string; entry_no: string; entry_date: string; description: string };
};

const generalLedger: ReportDefinition = {
  key: "general-ledger",
  title: "General ledger",
  description: "Every posted line by account, with running balances. Click an entry number to open the journal.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "period",
  branchFilter: true,
  options: [{ name: "group", label: "Accounts", choices: ACCOUNT_GROUPS }],
  async run(supabase, f) {
    const accountFilter = f.options.account;
    const list = (await balances(supabase, f.from, f.to, f)).filter(
      (b) =>
        (f.options.group === "all" || b.account_type === f.options.group) &&
        (!accountFilter || b.code === accountFilter) &&
        (n(b.opening) || n(b.debit) || n(b.credit)),
    );

    let branchIds: string[] | null = f.branch ? [f.branch] : null;
    if (!branchIds && f.region) {
      const { data } = await supabase.from("branches").select("id").eq("region_id", f.region);
      branchIds = (data ?? []).map((b) => b.id);
    }
    let query = supabase
      .from("journal_lines")
      .select("account_code, debit, credit, description, branch_id, journal_entries!inner(id, entry_no, entry_date, description, status)")
      .eq("journal_entries.status", "posted")
      .gte("journal_entries.entry_date", f.from)
      .lte("journal_entries.entry_date", f.to)
      .in("account_code", list.map((b) => b.code))
      .limit(10000);
    if (branchIds) query = query.in("branch_id", branchIds);
    const { data, error } = await query;
    if (error) throw dbFailure(error);
    const lines = (data as unknown as LedgerLine[]).sort(
      (a, b) =>
        a.journal_entries.entry_date.localeCompare(b.journal_entries.entry_date) ||
        a.journal_entries.entry_no.localeCompare(b.journal_entries.entry_no),
    );

    const rows: Row[] = [];
    for (const account of list) {
      let running = n(account.opening);
      rows.push({ entry: `${account.code} ${account.name}`, _kind: "heading" });
      rows.push({ entry: "", description: "Opening balance", balance: round(running) });
      for (const l of lines.filter((x) => x.account_code === account.code)) {
        running += n(l.debit) - n(l.credit);
        rows.push({
          entry: l.journal_entries.entry_no,
          date: l.journal_entries.entry_date,
          description: l.description || l.journal_entries.description,
          debit: n(l.debit) || null,
          credit: n(l.credit) || null,
          balance: round(running),
          _href: `/accounts/journals/${l.journal_entries.id}`,
        });
      }
      rows.push({ entry: "", description: "Closing balance", debit: account.debit, credit: account.credit, balance: account.closing, _kind: "subtotal" });
    }
    return {
      columns: [
        { key: "entry", label: "Entry" },
        { key: "date", label: "Date", kind: "date" },
        { key: "description", label: "Description" },
        { key: "debit", label: "Debit", kind: "money" },
        { key: "credit", label: "Credit", kind: "money" },
        { key: "balance", label: "Balance (Dr +)", kind: "money" },
      ],
      rows,
    };
  },
};

const memberBalances: ReportDefinition = {
  key: "member-balances",
  title: "Member savings and loans",
  description: "Each member's savings, amounts payable, capital and loan principal from the member subledger.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "asAt",
  branchFilter: true,
  async run(supabase, f) {
    const { data, error } = await supabase.rpc("member_balances", { p_as_at: f.to, p_branch_id: f.branch, p_region_id: f.region });
    if (error) throw dbFailure(error);
    const list = data as Record<string, string>[];
    const keys = ["savings", "fixed_term", "matured_payable", "roi_payable", "capital", "loan_principal", "interest_paid"];
    const total: Row = { member_name: "Total", _kind: "total" };
    for (const k of keys) total[k] = round(list.reduce((s, r) => s + n(r[k]), 0));
    return {
      columns: [
        { key: "member_name", label: "Member" },
        { key: "membership_no", label: "Membership no." },
        { key: "savings", label: "Savings", kind: "money" },
        { key: "fixed_term", label: "Fixed-term", kind: "money" },
        { key: "matured_payable", label: "Matured payable", kind: "money" },
        { key: "roi_payable", label: "ROI payable", kind: "money" },
        { key: "capital", label: "Capital", kind: "money" },
        { key: "loan_principal", label: "Loan principal", kind: "money" },
        { key: "interest_paid", label: "Interest paid", kind: "money" },
      ],
      rows: [...list.map((r) => ({ ...r }) as Row), total],
      notes: ["Contribution history and plan terms are on each member's file in Administration."],
    };
  },
};

const STATUS_CHOICES = [{ value: "open", label: "Open (not posted)" }, { value: "all", label: "All statuses" }].concat(
  Object.entries(FINANCE_STATUSES).map(([value, s]) => ({ value, label: s.label })),
);

const transactionRegister: ReportDefinition = {
  key: "transactions",
  title: "Receipts and payments register",
  description: "Receipts and payment requests with who prepared, approved and paid them, and how long open items have waited.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "period",
  branchFilter: true,
  options: [
    { name: "direction", label: "Type", choices: [{ value: "all", label: "Receipts and payments" }, { value: "receipt", label: "Receipts" }, { value: "payment", label: "Payments" }] },
    { name: "status", label: "Status", choices: STATUS_CHOICES },
  ],
  async run(supabase, f) {
    let query = supabase
      .from("finance_transactions")
      .select("id, txn_no, txn_date, direction, transaction_type, counterparty, amount, status, branch_id, created_by, approved_by, paid_by, created_at, posted_at, members(first_name, last_name), posting_rules(name), branches!inner(region_id)")
      .gte("txn_date", f.from)
      .lte("txn_date", f.to)
      .order("txn_date")
      .limit(5000);
    if (f.branch) query = query.eq("branch_id", f.branch);
    if (f.region) query = query.eq("branches.region_id", f.region);
    if (f.options.direction !== "all") query = query.eq("direction", f.options.direction);
    if (f.options.status === "open") query = query.in("status", ["draft", "submitted", "returned", "approved"]);
    else if (f.options.status !== "all") query = query.eq("status", f.options.status);
    const { data, error } = await query;
    if (error) throw dbFailure(error);
    type T = {
      id: string; txn_no: string; txn_date: string; direction: string; counterparty: string | null; amount: string; status: keyof typeof FINANCE_STATUSES;
      created_by: string; approved_by: string | null; paid_by: string | null; created_at: string; posted_at: string | null;
      members: { first_name: string; last_name: string } | null; posting_rules: { name: string };
    };
    const list = data as unknown as T[];
    const names = await staffNames(supabase, list.flatMap((t) => [t.created_by, t.approved_by, t.paid_by]));
    const now = Date.now();
    return {
      columns: [
        { key: "txn_no", label: "No." },
        { key: "txn_date", label: "Date", kind: "date" },
        { key: "type", label: "Type" },
        { key: "party", label: "Member / beneficiary" },
        { key: "amount", label: "Amount", kind: "money" },
        { key: "status", label: "Status" },
        { key: "age", label: "Days open", kind: "number" },
        { key: "prepared", label: "Prepared by" },
        { key: "approved", label: "Approved by" },
        { key: "paid", label: "Paid by" },
      ],
      rows: list.map((t) => ({
        txn_no: t.txn_no,
        txn_date: t.txn_date,
        type: t.posting_rules.name,
        party: t.members ? `${t.members.first_name} ${t.members.last_name}` : t.counterparty,
        amount: t.direction === "payment" ? -n(t.amount) : n(t.amount),
        status: FINANCE_STATUSES[t.status].label,
        age: ["posted", "reversed", "rejected"].includes(t.status) ? null : Math.floor((now - Date.parse(t.created_at)) / 86_400_000),
        prepared: names.get(t.created_by) ?? "",
        approved: t.approved_by ? (names.get(t.approved_by) ?? "") : "",
        paid: t.paid_by ? (names.get(t.paid_by) ?? "") : "",
        _href: `/accounts/transactions/${t.id}`,
      })),
      notes: ["Payments show as negative amounts."],
    };
  },
};

const bankReconciliations: ReportDefinition = {
  key: "bank-reconciliations",
  title: "Bank reconciliations",
  description: "Statement against ledger balances, unmatched items, the difference and who reviewed each reconciliation.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "period",
  branchFilter: true,
  async run(supabase, f) {
    let query = supabase
      .from("bank_reconciliations")
      .select("*, bank_accounts(name), branches!inner(region_id)")
      .gte("period_end", f.from)
      .lte("period_end", f.to)
      .order("period_end", { ascending: false });
    if (f.branch) query = query.eq("branch_id", f.branch);
    if (f.region) query = query.eq("branches.region_id", f.region);
    const { data, error } = await query;
    if (error) throw dbFailure(error);
    const list = data as (Record<string, string> & { bank_accounts: { name: string }; branches: unknown })[];
    const names = await staffNames(supabase, list.flatMap((r) => [r.prepared_by, r.completed_by]));
    return {
      columns: [
        { key: "bank", label: "Bank account" },
        { key: "period_end", label: "Period end", kind: "date" },
        { key: "statement_balance", label: "Statement balance", kind: "money" },
        { key: "ledger_balance", label: "Ledger balance", kind: "money" },
        { key: "unmatched_statement_total", label: "Unmatched on statement", kind: "money" },
        { key: "unmatched_ledger_total", label: "Unmatched in ledger", kind: "money" },
        { key: "difference", label: "Difference", kind: "money" },
        { key: "status", label: "Status" },
        { key: "prepared", label: "Prepared by" },
        { key: "reviewed", label: "Reviewed by" },
      ],
      rows: list.map(({ bank_accounts, branches: _branch, ...r }) => ({
        ...r,
        bank: bank_accounts.name,
        status: r.status === "completed" ? "Completed" : "Draft",
        prepared: names.get(r.prepared_by) ?? "",
        reviewed: r.completed_by ? (names.get(r.completed_by) ?? "") : "",
        _href: `/accounts/bank/${r.bank_account_id}`,
      })),
    };
  },
};

export const accountsReports: ReportDefinition[] = [
  profitAndLoss,
  balanceSheet,
  cashFlow,
  trialBalance,
  generalLedger,
  memberBalances,
  transactionRegister,
  bankReconciliations,
];
