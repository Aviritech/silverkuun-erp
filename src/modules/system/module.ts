import type { DepartmentModule } from "../types";

export const systemModule: DepartmentModule = {
  department: "system",
  name: "System Administration",
  description: "Staff logins and access, branches, regions and departments.",
  basePath: "/system",
  permission: "module.system",
  nav: [
    { label: "Overview", href: "/system" },
    { label: "Staff access", href: "/system/staff", permission: "staff.read" },
    { label: "Organisation", href: "/system/organisation", permission: "system.manage" },
  ],
};
