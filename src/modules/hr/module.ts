import type { DepartmentModule } from "../types";

export const hrModule: DepartmentModule = {
  department: "hr",
  name: "HR/Admin",
  description: "Employee records, leave, payroll, performance, training and commission.",
  basePath: "/hr",
  permission: "module.hr",
  nav: [
    { section: "Workspace", label: "Overview", href: "/hr", permission: "hr.read" },
    { section: "Workspace", label: "Employees", href: "/hr/employees", permission: "hr.read" },
    { section: "Workspace", label: "Leave", href: "/hr/leave", permission: "hr.read" },
    { section: "Pay", label: "Payroll", href: "/hr/payroll", permission: "payroll.read" },
    { section: "Pay", label: "Commission", href: "/hr/commissions", permission: ["hr.read", "commission.manage", "commission.approve", "payroll.read"] },
    { section: "Growth", label: "Performance", href: "/hr/performance", permission: "performance.read" },
    { section: "Growth", label: "Training", href: "/hr/training" },
    { section: "Setup", label: "Reports", href: "/hr/reports", permission: ["hr.read", "payroll.read"] },
    { section: "Setup", label: "Settings", href: "/hr/settings", permission: "hr.read" },
  ],
};
