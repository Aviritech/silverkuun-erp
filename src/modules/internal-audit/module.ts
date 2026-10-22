import type { DepartmentModule } from "../types";

export const internalAuditModule: DepartmentModule = {
  department: "internal_audit",
  name: "Internal Audit",
  description: "Read-only oversight of records, approvals, money and changes across every branch.",
  basePath: "/internal-audit",
  permission: "module.internal_audit",
  nav: [
    { label: "Dashboard", href: "/internal-audit" },
    { label: "Exceptions", href: "/internal-audit/reports/exceptions" },
    { label: "Customer register", href: "/internal-audit/reports/customer-register" },
    { label: "Branch reports", href: "/internal-audit/reports/branch-operations" },
    { label: "Financial reports", href: "/accounts/reports", permission: "accounts.read" },
    { label: "Audit trail", href: "/internal-audit/reports/audit-trail", permission: "audit.trail.read" },
    { label: "Whistleblowing", href: "/internal-audit/whistleblowing", permission: "whistleblowing.manage" },
  ],
};
