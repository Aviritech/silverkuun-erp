import type { DepartmentModule } from "../types";

export const creditModule: DepartmentModule = {
  department: "credit",
  name: "Credit",
  description: "Loan applications, appraisal and approval, disbursement, repayment tracking and the loan portfolio.",
  basePath: "/credit",
  permission: "module.credit",
  nav: [
    { label: "Dashboard", href: "/credit" },
    { label: "Loans", href: "/credit/loans", permission: "credit.read" },
    { label: "Approvals", href: "/credit/approvals", permission: "credit.read" },
    { label: "Repayments due", href: "/credit/reminders", permission: "credit.read" },
    { label: "Reports", href: "/credit/reports", permission: "credit.read" },
    { label: "Loan products", href: "/credit/products", permission: "credit.read" },
  ],
};
