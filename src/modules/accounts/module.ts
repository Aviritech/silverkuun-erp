import type { DepartmentModule } from "../types";

export const accountsModule: DepartmentModule = {
  department: "accounts",
  name: "Accounts",
  description: "Receipts, payments, the general ledger, bank reconciliation and financial reports.",
  basePath: "/accounts",
  permission: "module.accounts",
  nav: [
    { label: "Overview", href: "/accounts" },
    { label: "Receipts & payments", href: "/accounts/transactions", permission: "accounts.read" },
    { label: "From Administration", href: "/accounts/contributions", permission: "accounts.receipts.record" },
    { label: "Loans to pay out", href: "/accounts/loans", permission: "accounts.read" },
    { label: "Bills", href: "/accounts/bills", permission: "accounts.read" },
    { label: "Suppliers", href: "/accounts/suppliers", permission: "accounts.read" },
    { label: "Journals", href: "/accounts/journals", permission: "accounts.read" },
    { label: "ROI accrual", href: "/accounts/roi-accrual", permission: "accounts.journals.prepare" },
    { label: "Bank reconciliation", href: "/accounts/bank", permission: "accounts.read" },
    { label: "Reports", href: "/accounts/reports", permission: "accounts.read" },
    { label: "Settings", href: "/accounts/settings", permission: "accounts.read" },
  ],
};
