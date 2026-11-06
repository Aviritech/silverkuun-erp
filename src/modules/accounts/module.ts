import type { DepartmentModule } from "../types";

export const accountsModule: DepartmentModule = {
  department: "accounts",
  name: "Accounts",
  description: "Receipts, payments, the general ledger, bank reconciliation and financial reports.",
  basePath: "/accounts",
  permission: "module.accounts",
  nav: [
    { section: "Workspace", label: "Overview", href: "/accounts" },
    { section: "Workspace", label: "Savings pay-ins", href: "/accounts/contributions", permission: "accounts.receipts.record" },
    { section: "Workspace", label: "Receivables aging", href: "/accounts/receivables", permission: "accounts.read" },
    { section: "Workspace", label: "Payables", href: "/accounts/bills", permission: "accounts.read" },
    { section: "Workspace", label: "Suppliers", href: "/accounts/suppliers", permission: "accounts.read" },
    { section: "Workspace", label: "Receipts & payments", href: "/accounts/transactions", permission: "accounts.read" },
    { section: "Workspace", label: "Loans to pay out", href: "/accounts/loans", permission: "accounts.read" },
    { section: "Workspace", label: "Liquidations to pay", href: "/accounts/liquidations", permission: "accounts.read" },
    { section: "Workspace", label: "Interest payments", href: "/accounts/reports/interest-payments", permission: "accounts.payments.request" },
    { section: "Finance", label: "Bank reconciliation", href: "/accounts/bank", permission: "accounts.read" },
    { section: "Finance", label: "Journals", href: "/accounts/journals", permission: "accounts.read" },
    { section: "Finance", label: "ROI accrual", href: "/accounts/roi-accrual", permission: "accounts.journals.prepare" },
    { section: "Finance", label: "Reports", href: "/accounts/reports", permission: "accounts.read" },
    { section: "Finance", label: "Chart of accounts", href: "/accounts/chart", permission: "accounts.read" },
    { section: "Finance", label: "Settings", href: "/accounts/settings", permission: "accounts.read" },
    { section: "Control", label: "Approvals", href: "/accounts/approvals", permission: "accounts.read" },
    { section: "Control", label: "Activity", href: "/accounts/activity", permission: "accounts.read" },
  ],
};
