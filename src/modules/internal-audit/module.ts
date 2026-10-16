import type { DepartmentModule } from "../types";

export const internalAuditModule: DepartmentModule = {
  department: "internal_audit",
  name: "Internal Audit",
  description: "Read-only oversight of records, approvals and changes across every branch.",
  basePath: "/internal-audit",
  permission: "module.internal_audit",
  nav: [
    { label: "Overview", href: "/internal-audit" },
    { label: "Audit trail", href: "/internal-audit/trail", permission: "audit.trail.read" },
  ],
};
