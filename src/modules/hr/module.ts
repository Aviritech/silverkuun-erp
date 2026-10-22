import type { DepartmentModule } from "../types";

export const hrModule: DepartmentModule = {
  department: "hr",
  name: "HR/Admin",
  description: "Employee records, leave, payroll, performance, training and commission.",
  basePath: "/hr",
  permission: "module.hr",
  nav: [
    { label: "Overview", href: "/hr", permission: "hr.read" },
    { label: "Employees", href: "/hr/employees", permission: "hr.read" },
    { label: "Leave", href: "/hr/leave", permission: "hr.read" },
    { label: "Payroll", href: "/hr/payroll", permission: "payroll.read" },
    { label: "Performance", href: "/hr/performance", permission: "performance.read" },
    { label: "Training", href: "/hr/training" },
    { label: "Commission", href: "/hr/commissions", permission: ["hr.read", "commission.manage", "commission.approve", "payroll.read"] },
    { label: "Reports", href: "/hr/reports", permission: ["hr.read", "payroll.read"] },
    { label: "Settings", href: "/hr/settings", permission: "hr.read" },
  ],
};
