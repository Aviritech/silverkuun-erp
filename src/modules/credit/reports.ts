import type { SupabaseClient } from "@supabase/supabase-js";
import { dbFailure } from "@/lib/db-errors";
import type { Column, ReportDefinition, ReportFilters, Row } from "@/lib/reports/types";
import {
  bookFilterOptions,
  fetchAll,
  inPeriod,
  isDisbursed,
  isOnBook,
  isPending,
  loadBook,
  loadOfficerNames,
  n,
  outstanding,
  pct,
  portfolio,
  round2,
  wasApproved,
} from "./book";
import { ARREARS_BUCKETS, CUSTOMER_CATEGORIES, LOAN_STATUSES, REMINDER_WINDOW_DAYS, arrearsBucket } from "./constants";
import type { LoanBookRow } from "./queries";

const loanHref = (id: string) => `/credit/loans/${id}`;

async function branchNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("branches").select("id, name");
  if (error) throw dbFailure(error);
  return new Map((data as { id: string; name: string }[]).map((b) => [b.id, b.name]));
}

function book(supabase: SupabaseClient, f: ReportFilters) {
  return loadBook(supabase, {
    branch: f.branch,
    region: f.region,
    officer: f.options.officer,
    product: f.options.loan_product,
    category: f.options.category,
  });
}

/** Names for a grouping, so loans can be summed by branch, officer, product, category, month or year. */
type Grouping = "loan" | "branch" | "officer" | "product" | "category" | "month" | "year";

const GROUP_CHOICES: Record<Grouping, string> = {
  loan: "Each loan",
  branch: "By branch",
  officer: "By account officer",
  product: "By loan product",
  category: "By customer category",
  month: "By month",
  year: "By year",
};

function groupOption(choices: Grouping[]) {
  return { name: "group", label: "Show", choices: choices.map((value) => ({ value, label: GROUP_CHOICES[value] })) };
}

function grouper(group: Grouping, branches: Map<string, string>, officers: Map<string, string>, date: (l: LoanBookRow) => string | null) {
  return (l: LoanBookRow): string => {
    switch (group) {
      case "branch":
        return branches.get(l.branch_id) ?? "Unknown branch";
      case "officer":
        return officers.get(l.account_officer_id) ?? "Former officer";
      case "product":
        return l.product_name;
      case "category":
        return CUSTOMER_CATEGORIES[l.customer_category];
      case "month":
        return (date(l) ?? "").slice(0, 7);
      case "year":
        return (date(l) ?? "").slice(0, 4);
      default:
        return l.loan_no;
    }
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map].sort((a, b) => a[0].localeCompare(b[0]));
}

function totalRow(rows: Row[], label: string, keys: string[], firstKey = "name"): Row {
  const total: Row = { [firstKey]: label, _kind: "total" };
  for (const k of keys) total[k] = round2(rows.reduce((s, r) => s + n(r[k]), 0));
  return total;
}

// ---------------------------------------------------------------------------

const loanApplications: ReportDefinition = {
  key: "loan-applications",
  title: "Loan applications",
  description: "Applications received in the period with their status: pending, approved, rejected or awaiting disbursement.",
  basePath: "/credit",
  permission: "credit.read",
  dates: "period",
  branchFilter: true,
  options: [
    {
      name: "status",
      label: "Status",
      choices: [
        { value: "all", label: "All applications" },
        { value: "pending", label: "Pending (not yet decided)" },
        { value: "approved", label: "Approved" },
        { value: "awaiting", label: "Awaiting disbursement" },
        { value: "rejected", label: "Rejected" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
  ],
  loadOptions: bookFilterOptions,
  async run(supabase, f) {
    const [loans, branches, officers] = await Promise.all([book(supabase, f), branchNames(supabase), loadOfficerNames(supabase)]);
    const received = loans.filter((l) => inPeriod(l.created_at, f.from, f.to));
    const match: Record<string, (l: LoanBookRow) => boolean> = {
      all: () => true,
      pending: isPending,
      approved: wasApproved,
      awaiting: (l) => l.status === "approved",
      rejected: (l) => l.status === "rejected",
      cancelled: (l) => l.status === "cancelled",
    };
    const chosen = received.filter(match[f.options.status] ?? match.all).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const today = new Date().toISOString().slice(0, 10);
    const rows: Row[] = chosen.map((l) => ({
      loan_no: l.loan_no,
      _href: loanHref(l.id),
      applied: l.created_at,
      member: l.member_name,
      branch: branches.get(l.branch_id),
      officer: officers.get(l.account_officer_id),
      product: l.product_name,
      category: CUSTOMER_CATEGORIES[l.customer_category],
      requested: n(l.amount_requested),
      approved: l.approved_amount === null ? null : n(l.approved_amount),
      status: LOAN_STATUSES[l.status].label,
      days_open: isPending(l) ? Math.round((Date.parse(today) - Date.parse(l.created_at.slice(0, 10))) / 86_400_000) : null,
    }));
    const count = (fn: (l: LoanBookRow) => boolean) => received.filter(fn).length;
    return {
      columns: [
        { key: "loan_no", label: "Loan" },
        { key: "applied", label: "Applied", kind: "date" },
        { key: "member", label: "Customer" },
        { key: "branch", label: "Branch" },
        { key: "officer", label: "Account officer" },
        { key: "product", label: "Product" },
        { key: "category", label: "Category" },
        { key: "requested", label: "Requested", kind: "money" },
        { key: "approved", label: "Approved", kind: "money" },
        { key: "status", label: "Status" },
        { key: "days_open", label: "Days pending", kind: "number" },
      ],
      rows: rows.length ? [...rows, { ...totalRow(rows, "Total", ["requested", "approved"], "loan_no"), member: `${rows.length} applications` }] : [],
      notes: [
        `In the period: ${received.length} received, ${count(isPending)} pending, ${count(wasApproved)} approved (${count((l) => l.status === "approved")} awaiting disbursement), ${count((l) => l.status === "rejected")} rejected, ${count((l) => l.status === "cancelled")} cancelled.`,
      ],
    };
  },
};

const disbursements: ReportDefinition = {
  key: "loan-disbursements",
  title: "Loan approvals and disbursements",
  description: "Loans approved and paid out in the period, customers funded, and what is still owed on them.",
  basePath: "/credit",
  permission: "credit.read",
  dates: "period",
  branchFilter: true,
  options: [groupOption(["branch", "officer", "product", "category", "month", "year", "loan"])],
  loadOptions: bookFilterOptions,
  async run(supabase, f) {
    const [loans, branches, officers] = await Promise.all([book(supabase, f), branchNames(supabase), loadOfficerNames(supabase)]);
    const approved = loans.filter((l) => l.approved_at && inPeriod(l.approved_at, f.from, f.to));
    const disbursed = loans.filter((l) => isDisbursed(l) && inPeriod(l.disbursed_on, f.from, f.to));
    const group = f.options.group as Grouping;

    if (group === "loan") {
      const rows: Row[] = disbursed
        .sort((a, b) => (a.disbursed_on ?? "").localeCompare(b.disbursed_on ?? ""))
        .map((l) => ({
          name: l.loan_no,
          _href: loanHref(l.id),
          member: l.member_name,
          branch: branches.get(l.branch_id),
          officer: officers.get(l.account_officer_id),
          product: l.product_name,
          disbursed_on: l.disbursed_on,
          disbursed: n(l.approved_amount),
          maturity: l.maturity_date,
          outstanding_principal: n(l.outstanding_principal),
          outstanding_interest: n(l.outstanding_interest),
          status: LOAN_STATUSES[l.status].label,
        }));
      return {
        columns: [
          { key: "name", label: "Loan" },
          { key: "member", label: "Customer" },
          { key: "branch", label: "Branch" },
          { key: "officer", label: "Account officer" },
          { key: "product", label: "Product" },
          { key: "disbursed_on", label: "Disbursed", kind: "date" },
          { key: "disbursed", label: "Amount", kind: "money" },
          { key: "maturity", label: "Matures", kind: "date" },
          { key: "outstanding_principal", label: "Principal owed", kind: "money" },
          { key: "outstanding_interest", label: "Interest owed", kind: "money" },
          { key: "status", label: "Status" },
        ],
        rows: rows.length ? [...rows, totalRow(rows, "Total", ["disbursed", "outstanding_principal", "outstanding_interest"])] : [],
      };
    }

    const keyOf = grouper(group, branches, officers, (l) => l.disbursed_on ?? l.approved_at);
    const names = new Set([...approved, ...disbursed].map(keyOf));
    const rows: Row[] = [...names].sort().map((name) => {
      const a = approved.filter((l) => keyOf(l) === name);
      const d = disbursed.filter((l) => keyOf(l) === name);
      return {
        name,
        approved_count: a.length,
        approved_amount: round2(a.reduce((s, l) => s + n(l.approved_amount), 0)),
        disbursed_count: d.length,
        customers: new Set(d.map((l) => l.member_id)).size,
        disbursed_amount: round2(d.reduce((s, l) => s + n(l.approved_amount), 0)),
        outstanding_principal: round2(d.reduce((s, l) => s + n(l.outstanding_principal), 0)),
        outstanding_interest: round2(d.reduce((s, l) => s + n(l.outstanding_interest), 0)),
      };
    });
    const sums = ["approved_count", "approved_amount", "disbursed_count", "disbursed_amount", "outstanding_principal", "outstanding_interest"];
    return {
      columns: [
        { key: "name", label: GROUP_CHOICES[group].replace("By ", "").replace(/^./, (c) => c.toUpperCase()) },
        { key: "approved_count", label: "Approved", kind: "number" },
        { key: "approved_amount", label: "Amount approved", kind: "money" },
        { key: "disbursed_count", label: "Disbursed", kind: "number" },
        { key: "customers", label: "Customers funded", kind: "number" },
        { key: "disbursed_amount", label: "Amount disbursed", kind: "money" },
        { key: "outstanding_principal", label: "Principal still owed", kind: "money" },
        { key: "outstanding_interest", label: "Interest still owed", kind: "money" },
      ],
      rows: rows.length ? [...rows, { ...totalRow(rows, "Total", sums), customers: new Set(disbursed.map((l) => l.member_id)).size }] : [],
      notes: ["Approved counts loans approved in the period; disbursed counts loans Accounts paid out in the period. Amounts owed are as at today."],
    };
  },
};

function portfolioReport(key: string, basePath: ReportDefinition["basePath"], permission: string): ReportDefinition {
  return {
    key,
    title: "Loan portfolio",
    description: "Outstanding principal and interest on the loan book today, the portfolio at risk by days overdue, and the suggested impairment.",
    basePath,
    permission,
    dates: "none",
    branchFilter: true,
    options: [
      {
        name: "group",
        label: "Show",
        choices: [{ value: "arrears", label: "By days overdue" }, ...groupOption(["branch", "officer", "product", "category", "loan"]).choices],
      },
    ],
    loadOptions: bookFilterOptions,
    async run(supabase, f) {
      const [loans, branches, officers] = await Promise.all([book(supabase, f), branchNames(supabase), loadOfficerNames(supabase)]);
      const live = loans.filter(isOnBook);
      const total = portfolio(live);
      const notes = [
        `${total.loans} loans to ${total.customers} customers. Portfolio at risk: ${pct(total.par1, total.principal)} over 1 day, ${pct(total.par30, total.principal)} over 30 days, ${pct(total.par90, total.principal)} over 90 days.`,
        "Suggested provision rates (1%, 5%, 20%, 50%, 100% of principal by days overdue) follow the CBN guidelines for microfinance banks until Kuun confirms its own impairment policy.",
      ];

      if (f.options.group === "arrears") {
        const rows: Row[] = ARREARS_BUCKETS.map((b) => {
          const inBucket = live.filter((l) => arrearsBucket(l.days_past_due).key === b.key);
          const principal = inBucket.reduce((s, l) => s + n(l.outstanding_principal), 0);
          return {
            name: b.label,
            loans: inBucket.length,
            principal: round2(principal),
            interest: round2(inBucket.reduce((s, l) => s + n(l.outstanding_interest), 0)),
            overdue: round2(inBucket.reduce((s, l) => s + n(l.overdue_amount), 0)),
            share: pct(principal, total.principal),
            rate: `${b.provision * 100}%`,
            provision: round2(principal * b.provision),
          };
        });
        return {
          columns: [
            { key: "name", label: "Days overdue" },
            { key: "loans", label: "Loans", kind: "number" },
            { key: "principal", label: "Principal outstanding", kind: "money" },
            { key: "interest", label: "Interest outstanding", kind: "money" },
            { key: "overdue", label: "Amount overdue", kind: "money" },
            { key: "share", label: "Share of book" },
            { key: "rate", label: "Provision rate" },
            { key: "provision", label: "Suggested provision", kind: "money" },
          ],
          rows: [...rows, { ...totalRow(rows, "Total", ["loans", "principal", "interest", "overdue", "provision"]), share: "100%" }],
          notes,
        };
      }

      if (f.options.group === "loan") {
        const rows: Row[] = live
          .sort((a, b) => b.days_past_due - a.days_past_due || a.loan_no.localeCompare(b.loan_no))
          .map((l) => {
            const bucket = arrearsBucket(l.days_past_due);
            return {
              name: l.loan_no,
              _href: basePath === "/credit" ? loanHref(l.id) : undefined,
              member: l.member_name,
              branch: branches.get(l.branch_id),
              officer: officers.get(l.account_officer_id),
              product: l.product_name,
              disbursed: n(l.approved_amount),
              principal: n(l.outstanding_principal),
              interest: n(l.outstanding_interest),
              overdue: n(l.overdue_amount),
              days: l.days_past_due,
              maturity: l.maturity_date,
              provision: round2(n(l.outstanding_principal) * bucket.provision),
            };
          });
        return {
          columns: [
            { key: "name", label: "Loan" },
            { key: "member", label: "Customer" },
            { key: "branch", label: "Branch" },
            { key: "officer", label: "Account officer" },
            { key: "product", label: "Product" },
            { key: "disbursed", label: "Disbursed", kind: "money" },
            { key: "principal", label: "Principal owed", kind: "money" },
            { key: "interest", label: "Interest owed", kind: "money" },
            { key: "overdue", label: "Overdue", kind: "money" },
            { key: "days", label: "Days overdue", kind: "number" },
            { key: "maturity", label: "Matures", kind: "date" },
            { key: "provision", label: "Suggested provision", kind: "money" },
          ],
          rows: rows.length ? [...rows, totalRow(rows, "Total", ["disbursed", "principal", "interest", "overdue", "provision"])] : [],
          notes,
        };
      }

      const keyOf = grouper(f.options.group as Grouping, branches, officers, () => null);
      const rows: Row[] = groupBy(live, keyOf).map(([name, group]) => {
        const p = portfolio(group);
        return {
          name,
          loans: p.loans,
          customers: p.customers,
          principal: p.principal,
          interest: p.interest,
          overdue: p.overdue,
          par30_amount: p.par30,
          par30: pct(p.par30, p.principal),
          provision: p.provision,
        };
      });
      return {
        columns: [
          { key: "name", label: GROUP_CHOICES[f.options.group as Grouping].replace("By ", "").replace(/^./, (c) => c.toUpperCase()) },
          { key: "loans", label: "Loans", kind: "number" },
          { key: "customers", label: "Customers", kind: "number" },
          { key: "principal", label: "Principal outstanding", kind: "money" },
          { key: "interest", label: "Interest outstanding", kind: "money" },
          { key: "overdue", label: "Amount overdue", kind: "money" },
          { key: "par30_amount", label: "At risk over 30 days", kind: "money" },
          { key: "par30", label: "PAR 30" },
          { key: "provision", label: "Suggested provision", kind: "money" },
        ],
        rows: rows.length
          ? [...rows, { ...totalRow(rows, "Total", ["loans", "principal", "interest", "overdue", "par30_amount", "provision"]), customers: total.customers, par30: pct(total.par30, total.principal) }]
          : [],
        notes,
      };
    },
  };
}

type RepaymentRow = { loan_id: string; paid_on: string; amount: string; principal: string; interest: string; reversed_at: string | null; txn_no: string };
type DueRow = { loan_id: string; due_date: string; principal_due: string; interest_due: string; outstanding: string; status: string; installment_no: number };

const repayments: ReportDefinition = {
  key: "loan-repayments",
  title: "Loan repayments",
  description: "What fell due in the period against what was collected, split into principal and interest.",
  basePath: "/credit",
  permission: "credit.read",
  dates: "period",
  branchFilter: true,
  options: [groupOption(["branch", "officer", "product", "month", "loan"])],
  loadOptions: bookFilterOptions,
  async run(supabase, f) {
    const [loans, branches, officers, paid, due] = await Promise.all([
      book(supabase, f),
      branchNames(supabase),
      loadOfficerNames(supabase),
      fetchAll<RepaymentRow>((a, b) =>
        supabase.from("loan_repayments").select("loan_id, paid_on, amount, principal, interest, reversed_at, txn_no").gte("paid_on", f.from).lte("paid_on", f.to).is("reversed_at", null).order("paid_on").range(a, b),
      ),
      fetchAll<DueRow>((a, b) =>
        supabase.from("loan_schedule_status").select("loan_id, due_date, principal_due, interest_due, outstanding, status, installment_no").gte("due_date", f.from).lte("due_date", f.to).order("due_date").range(a, b),
      ),
    ]);
    const byId = new Map(loans.map((l) => [l.id, l]));
    const group = f.options.group as Grouping;
    type Item = { loan: LoanBookRow; date: string; expected: number; collected: number; principal: number; interest: number; unpaid: number };
    const items: Item[] = [
      ...paid
        .filter((r) => byId.has(r.loan_id))
        .map((r) => ({ loan: byId.get(r.loan_id)!, date: r.paid_on, expected: 0, collected: n(r.amount), principal: n(r.principal), interest: n(r.interest), unpaid: 0 })),
      ...due
        .filter((d) => byId.has(d.loan_id))
        .map((d) => ({
          loan: byId.get(d.loan_id)!,
          date: d.due_date,
          expected: n(d.principal_due) + n(d.interest_due),
          collected: 0,
          principal: 0,
          interest: 0,
          unpaid: d.due_date < new Date().toISOString().slice(0, 10) ? n(d.outstanding) : 0,
        })),
    ];
    const base = grouper(group, branches, officers, () => null);
    const keyOf = (i: Item) => (group === "month" ? i.date.slice(0, 7) : base(i.loan));
    const rows: Row[] = groupBy(items, keyOf).map(([name, list]) => {
      const expected = list.reduce((s, i) => s + i.expected, 0);
      const collected = list.reduce((s, i) => s + i.collected, 0);
      return {
        name,
        _href: group === "loan" ? loanHref(list[0].loan.id) : undefined,
        member: group === "loan" ? list[0].loan.member_name : undefined,
        expected: round2(expected),
        collected: round2(collected),
        principal: round2(list.reduce((s, i) => s + i.principal, 0)),
        interest: round2(list.reduce((s, i) => s + i.interest, 0)),
        unpaid: round2(list.reduce((s, i) => s + i.unpaid, 0)),
        rate: pct(collected, expected),
      };
    });
    const columns: Column[] = [
      { key: "name", label: group === "loan" ? "Loan" : GROUP_CHOICES[group].replace("By ", "").replace(/^./, (c) => c.toUpperCase()) },
      ...(group === "loan" ? [{ key: "member", label: "Customer" }] : []),
      { key: "expected", label: "Fell due", kind: "money" },
      { key: "collected", label: "Collected", kind: "money" },
      { key: "principal", label: "Principal", kind: "money" },
      { key: "interest", label: "Interest", kind: "money" },
      { key: "unpaid", label: "Due and still unpaid", kind: "money" },
      { key: "rate", label: "Collected of due" },
    ];
    const total = totalRow(rows, "Total", ["expected", "collected", "principal", "interest", "unpaid"]);
    total.rate = pct(n(total.collected), n(total.expected));
    return {
      columns,
      rows: rows.length ? [...rows, total] : [],
      notes: [
        "Collections include early and late payments received in the period, so they can exceed what fell due. Reversed receipts are left out. Instalments are from each loan's current schedule.",
      ],
    };
  },
};

const overdueLoans: ReportDefinition = {
  key: "overdue-loans",
  title: "Overdue loans",
  description: "Every loan with a repayment past due today, oldest arrears first, with missed repayments and the officer responsible.",
  basePath: "/credit",
  permission: "credit.read",
  dates: "none",
  branchFilter: true,
  options: [
    {
      name: "days",
      label: "Overdue by",
      choices: [
        { value: "1", label: "Any amount of time" },
        { value: "31", label: "More than 30 days" },
        { value: "61", label: "More than 60 days" },
        { value: "91", label: "More than 90 days" },
      ],
    },
  ],
  loadOptions: bookFilterOptions,
  async run(supabase, f) {
    const [loans, branches, officers] = await Promise.all([book(supabase, f), branchNames(supabase), loadOfficerNames(supabase)]);
    const min = Number(f.options.days);
    const late = loans.filter((l) => isOnBook(l) && l.days_past_due >= min).sort((a, b) => b.days_past_due - a.days_past_due);
    const rows: Row[] = late.map((l) => ({
      name: l.loan_no,
      _href: loanHref(l.id),
      member: l.member_name,
      branch: branches.get(l.branch_id),
      officer: officers.get(l.account_officer_id),
      product: l.product_name,
      overdue: n(l.overdue_amount),
      missed: l.missed_repayments,
      days: l.days_past_due,
      bucket: arrearsBucket(l.days_past_due).label,
      outstanding: round2(outstanding(l)),
      last_paid: l.last_paid_on,
      maturity: l.maturity_date,
    }));
    return {
      columns: [
        { key: "name", label: "Loan" },
        { key: "member", label: "Customer" },
        { key: "branch", label: "Branch" },
        { key: "officer", label: "Account officer" },
        { key: "product", label: "Product" },
        { key: "overdue", label: "Overdue", kind: "money" },
        { key: "missed", label: "Missed repayments", kind: "number" },
        { key: "days", label: "Days overdue", kind: "number" },
        { key: "bucket", label: "Arrears" },
        { key: "outstanding", label: "Total owed", kind: "money" },
        { key: "last_paid", label: "Last paid", kind: "date" },
        { key: "maturity", label: "Matures", kind: "date" },
      ],
      rows: rows.length ? [...rows, totalRow(rows, "Total", ["overdue", "missed", "outstanding"])] : [],
    };
  },
};

const officerPerformance: ReportDefinition = {
  key: "officer-performance",
  title: "Account officer performance",
  description: "Per officer: applications raised and approved, loans disbursed, repayments collected, and the overdue portfolio they hold.",
  basePath: "/credit",
  permission: "credit.read",
  dates: "period",
  branchFilter: true,
  loadOptions: async (supabase) => (await bookFilterOptions(supabase)).filter((o) => o.name !== "officer"),
  async run(supabase, f) {
    const [loans, officers, paid, due] = await Promise.all([
      book(supabase, f),
      loadOfficerNames(supabase),
      fetchAll<RepaymentRow>((a, b) => supabase.from("loan_repayments").select("loan_id, amount").gte("paid_on", f.from).lte("paid_on", f.to).is("reversed_at", null).range(a, b)),
      fetchAll<DueRow>((a, b) => supabase.from("loan_schedule_status").select("loan_id, principal_due, interest_due").gte("due_date", f.from).lte("due_date", f.to).range(a, b)),
    ]);
    const officerOf = new Map(loans.map((l) => [l.id, l.account_officer_id]));
    const rows: Row[] = groupBy(loans, (l) => l.account_officer_id).map(([officer, list]) => {
      const raised = list.filter((l) => inPeriod(l.created_at, f.from, f.to));
      const decided = list.filter((l) => l.decided_at && inPeriod(l.decided_at, f.from, f.to));
      const disbursed = list.filter((l) => isDisbursed(l) && inPeriod(l.disbursed_on, f.from, f.to));
      const p = portfolio(list);
      const collected = paid.filter((r) => officerOf.get(r.loan_id) === officer).reduce((s, r) => s + n(r.amount), 0);
      const expected = due.filter((d) => officerOf.get(d.loan_id) === officer).reduce((s, d) => s + n(d.principal_due) + n(d.interest_due), 0);
      return {
        name: officers.get(officer) ?? "Former officer",
        raised: raised.length,
        approved: decided.filter(wasApproved).length,
        rejected: decided.filter((l) => l.status === "rejected").length,
        disbursed_count: disbursed.length,
        disbursed: round2(disbursed.reduce((s, l) => s + n(l.approved_amount), 0)),
        collected: round2(collected),
        collection_rate: pct(collected, expected),
        active: p.loans,
        principal: p.principal,
        overdue_loans: p.overdueLoans,
        overdue: p.overdue,
        par30: pct(p.par30, p.principal),
      };
    });
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const all = portfolio(loans);
    const allCollected = paid.filter((r) => officerOf.has(r.loan_id)).reduce((s, r) => s + n(r.amount), 0);
    const allExpected = due.filter((d) => officerOf.has(d.loan_id)).reduce((s, d) => s + n(d.principal_due) + n(d.interest_due), 0);
    return {
      columns: [
        { key: "name", label: "Account officer" },
        { key: "raised", label: "Applications", kind: "number" },
        { key: "approved", label: "Approved", kind: "number" },
        { key: "rejected", label: "Rejected", kind: "number" },
        { key: "disbursed_count", label: "Disbursed", kind: "number" },
        { key: "disbursed", label: "Amount disbursed", kind: "money" },
        { key: "collected", label: "Collected", kind: "money" },
        { key: "collection_rate", label: "Collected of due" },
        { key: "active", label: "Active loans", kind: "number" },
        { key: "principal", label: "Portfolio", kind: "money" },
        { key: "overdue_loans", label: "Overdue loans", kind: "number" },
        { key: "overdue", label: "Overdue amount", kind: "money" },
        { key: "par30", label: "PAR 30" },
      ],
      rows: rows.length
        ? [...rows, { ...totalRow(rows, "Total", ["raised", "approved", "rejected", "disbursed_count", "disbursed", "collected", "active", "principal", "overdue_loans", "overdue"]), par30: pct(all.par30, all.principal), collection_rate: pct(allCollected, allExpected) }]
        : [],
      notes: ["Applications, decisions, disbursements and collections are for the period; the portfolio and overdue figures are as at today."],
    };
  },
};

const dueRepayments: ReportDefinition = {
  key: "due-repayments",
  title: "Repayments falling due",
  description: "Instalments due in the coming days, for reminding customers before they fall behind.",
  basePath: "/credit",
  permission: "credit.read",
  dates: "none",
  branchFilter: true,
  options: [
    {
      name: "window",
      label: "Due within",
      choices: [
        { value: String(REMINDER_WINDOW_DAYS), label: `${REMINDER_WINDOW_DAYS} days` },
        { value: "14", label: "14 days" },
        { value: "30", label: "30 days" },
      ],
    },
  ],
  loadOptions: bookFilterOptions,
  async run(supabase, f) {
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + Number(f.options.window) * 86_400_000).toISOString().slice(0, 10);
    const [loans, branches, officers, due] = await Promise.all([
      book(supabase, f),
      branchNames(supabase),
      loadOfficerNames(supabase),
      fetchAll<DueRow>((a, b) =>
        supabase.from("loan_schedule_status").select("loan_id, due_date, outstanding, status, installment_no").gte("due_date", today).lte("due_date", until).gt("outstanding", 0).order("due_date").range(a, b),
      ),
    ]);
    const byId = new Map(loans.filter(isOnBook).map((l) => [l.id, l]));
    const rows: Row[] = due
      .filter((d) => byId.has(d.loan_id))
      .map((d) => {
        const l = byId.get(d.loan_id)!;
        return {
          due: d.due_date,
          name: l.loan_no,
          _href: loanHref(l.id),
          member: l.member_name,
          branch: branches.get(l.branch_id),
          officer: officers.get(l.account_officer_id),
          installment: d.installment_no,
          amount: n(d.outstanding),
          arrears: n(l.overdue_amount),
        };
      });
    return {
      columns: [
        { key: "due", label: "Due", kind: "date" },
        { key: "name", label: "Loan" },
        { key: "member", label: "Customer" },
        { key: "branch", label: "Branch" },
        { key: "officer", label: "Account officer" },
        { key: "installment", label: "Instalment", kind: "number" },
        { key: "amount", label: "Amount due", kind: "money" },
        { key: "arrears", label: "Already overdue", kind: "money" },
      ],
      rows: rows.length ? [...rows, totalRow(rows, "Total", ["amount", "arrears"])] : [],
    };
  },
};

export const creditReports: ReportDefinition[] = [
  portfolioReport("loan-portfolio", "/credit", "credit.read"),
  overdueLoans,
  loanApplications,
  disbursements,
  repayments,
  officerPerformance,
  dueRepayments,
];

/** The same portfolio for Accounts, who read the loan book without holding Credit permissions. */
export const accountsLoanPortfolio = portfolioReport("accounts-loan-portfolio", "/accounts", "accounts.read");
