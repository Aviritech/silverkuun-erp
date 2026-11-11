import type { DepartmentModule } from "../types";

export const internalAuditModule: DepartmentModule = {
  department: "internal_audit",
  name: "Internal Audit",
  description: "Oversight of records, approvals, money and changes across every branch, and approval of every payment before it goes out.",
  basePath: "/internal-audit",
  permission: "module.internal_audit",
  nav: [
    { section: "Workspace", label: "Overview", href: "/internal-audit" },
    { section: "Workspace", label: "Payments to approve", href: "/internal-audit/payments", permission: "audit.payments.approve" },
    { section: "Workspace", label: "Exceptions", href: "/internal-audit/reports/exceptions" },
    { section: "Workspace", label: "Whistleblowing", href: "/internal-audit/whistleblowing", permission: "whistleblowing.manage" },
    { section: "Reviews", label: "Customer register", href: "/internal-audit/reports/customer-register" },
    { section: "Reviews", label: "Branch reports", href: "/internal-audit/reports/branch-operations" },
    { section: "Reviews", label: "Financial reports", href: "/accounts/reports", permission: "accounts.read" },
    { section: "Control", label: "Audit trail", href: "/internal-audit/reports/audit-trail", permission: "audit.trail.read" },
  ],
};
