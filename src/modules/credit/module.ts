import type { DepartmentModule } from "../types";

export const creditModule: DepartmentModule = {
  department: "credit",
  name: "Credit",
  description: "Loan applications, appraisal and approval, disbursement, repayment tracking and the loan portfolio.",
  basePath: "/credit",
  permission: "module.credit",
  nav: [
    { section: "Workspace", label: "Overview", href: "/credit" },
    { section: "Workspace", label: "Approvals", href: "/credit/approvals", permission: "credit.read" },
    { section: "Workspace", label: "Repayments due", href: "/credit/reminders", permission: "credit.read" },
    { section: "Portfolio", label: "Loans", href: "/credit/loans", permission: "credit.read" },
    { section: "Portfolio", label: "Loan products", href: "/credit/products", permission: "credit.read" },
    { section: "Insight", label: "Reports", href: "/credit/reports", permission: "credit.read" },
  ],
};
