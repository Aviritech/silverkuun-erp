import { dbFailure } from "@/lib/db-errors";
import type { ReportDefinition, Row } from "@/lib/reports/types";
import { RECEIVABLE_BANDS, activeLoans, ledgerFigures, loanAging } from "./figures";

const round = (v: number) => Math.round(v * 100) / 100;

/** Member loan receivables by how far behind each loan is, for credit follow-up. */
export const receivablesAging: ReportDefinition = {
  key: "receivables-aging",
  title: "Receivables aging (member loans)",
  description: "What members owe on active loans, split into not yet due and days overdue, with the account officer following up.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "none",
  branchFilter: true,
  options: [
    {
      name: "view",
      label: "Show",
      choices: [
        { value: "loan", label: "Each loan" },
        { value: "branch", label: "Totals by branch" },
      ],
    },
  ],
  async run(supabase, f) {
    const [loans, officers, branches] = await Promise.all([
      activeLoans(supabase),
      supabase.rpc("credit_officers"),
      supabase.from("branches").select("id, name, region_id"),
    ]);
    if (officers.error) throw dbFailure(officers.error);
    if (branches.error) throw dbFailure(branches.error);
    const officerName = new Map((officers.data as { id: string; full_name: string }[]).map((o) => [o.id, o.full_name]));
    const branchName = new Map(branches.data.map((b) => [b.id, b.name]));
    const list = loans.filter((l) => (!f.branch || l.branch_id === f.branch) && (!f.region || l.region_id === f.region));

    const blank = (name: string): Row => {
      const r: Row = { name, total: 0 };
      for (const b of RECEIVABLE_BANDS) r[b.key] = 0;
      return r;
    };
    const add = (row: Row, l: (typeof list)[number]) => {
      const a = loanAging(l);
      row.current = round(Number(row.current) + a.notYetDue);
      if (a.band !== "current") row[a.band] = round(Number(row[a.band]) + a.overdue);
      row.total = round(Number(row.total) + a.total);
    };
    const total = { ...blank("Total"), _kind: "total" as const };
    let rows: Row[];
    if (f.options.view === "branch") {
      const byBranch = new Map<string, Row>();
      for (const l of list) {
        const row = byBranch.get(l.branch_id) ?? blank(branchName.get(l.branch_id) ?? "Branch");
        add(row, l);
        add(total, l);
        byBranch.set(l.branch_id, row);
      }
      rows = [...byBranch.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } else {
      rows = [...list]
        .sort((a, b) => b.days_past_due - a.days_past_due || a.loan_no.localeCompare(b.loan_no))
        .map((l) => {
          const row: Row = {
            ...blank(`${l.member_name} · ${l.loan_no}`),
            branch: branchName.get(l.branch_id) ?? "",
            days: l.days_past_due || null,
            officer: l.account_officer_id ? (officerName.get(l.account_officer_id) ?? "") : "",
          };
          add(row, l);
          add(total, l);
          return row;
        });
    }
    return {
      columns: [
        { key: "name", label: f.options.view === "branch" ? "Branch" : "Member and loan" },
        ...(f.options.view === "branch"
          ? []
          : ([
              { key: "branch", label: "Branch" },
              { key: "days", label: "Days overdue", kind: "number" },
              { key: "officer", label: "Follow-up (account officer)" },
            ] as const)),
        ...RECEIVABLE_BANDS.map((b) => ({ key: b.key, label: b.label, kind: "money" as const })),
        { key: "total", label: "Total owed", kind: "money" },
      ],
      rows: [...rows, total],
      notes: [
        "As at today, from the Credit loan book. Overdue amounts are repayments (principal and interest) past their due date and unpaid; the rest of each loan is under Not yet due.",
        "A loan's overdue amount sits in the band of its oldest unpaid repayment.",
      ],
    };
  },
};

/** Cash, member savings and loans by region and branch, with the consolidated Society total. */
export const locationSummary: ReportDefinition = {
  key: "location-summary",
  title: "Location summary (state and consolidated)",
  description: "Cash and bank, member savings, ROI payable, loans outstanding and loan arrears for each region and branch, rolled up to the Society total.",
  basePath: "/accounts",
  permission: "accounts.read",
  dates: "asAt",
  branchFilter: false,
  async run(supabase, f) {
    const [branches, regions, loans] = await Promise.all([
      supabase.from("branches").select("id, name, region_id").order("name"),
      supabase.from("regions").select("id, name").order("name"),
      activeLoans(supabase),
    ]);
    if (branches.error) throw dbFailure(branches.error);
    if (regions.error) throw dbFailure(regions.error);
    const ledger = await Promise.all(branches.data.map((b) => ledgerFigures(supabase, f.to, { branch: b.id })));
    const keys = ["cash", "savings", "roi", "loans", "overdue"] as const;
    const perBranch = branches.data.map((b, i) => {
      const own = loans.filter((l) => l.branch_id === b.id);
      return {
        ...b,
        cash: ledger[i].cash,
        savings: ledger[i].memberSavings,
        roi: ledger[i].roiPayable,
        loans: own.reduce((s, l) => s + Number(l.outstanding_principal), 0),
        overdue: own.reduce((s, l) => s + Number(l.overdue_amount), 0),
      };
    });
    const visible = perBranch.filter((b) => keys.some((k) => Math.abs(b[k]) >= 0.005));
    const sum = (list: typeof visible, name: string, kind?: Row["_kind"]): Row => {
      const row: Row = { name, _kind: kind };
      for (const k of keys) row[k] = round(list.reduce((s, b) => s + b[k], 0));
      return row;
    };

    const rows: Row[] = [];
    for (const r of regions.data) {
      const own = visible.filter((b) => b.region_id === r.id);
      if (!own.length) continue;
      rows.push({ name: r.name, _kind: "heading" });
      for (const b of own) rows.push(sum([b], b.name));
      rows.push(sum(own, `${r.name} total`, "subtotal"));
    }
    rows.push(sum(visible, "Consolidated Society total", "total"));
    return {
      columns: [
        { key: "name", label: "Region / branch" },
        { key: "cash", label: "Cash and bank", kind: "money" },
        { key: "savings", label: "Member savings", kind: "money" },
        { key: "roi", label: "ROI payable", kind: "money" },
        { key: "loans", label: "Loans outstanding", kind: "money" },
        { key: "overdue", label: "Loan arrears", kind: "money" },
      ],
      rows,
      notes: [
        "Cash, savings and ROI are posted ledger balances at the date. Loans outstanding and arrears are as at today, from the loan book.",
        "Branches with nothing you can see are left out, so a branch accountant sees only their own branches.",
      ],
    };
  },
};
