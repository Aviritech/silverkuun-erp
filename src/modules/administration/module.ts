import type { DepartmentModule } from "../types";

export const administrationModule: DepartmentModule = {
  department: "administration",
  name: "Administration",
  description: "Member onboarding, approvals, contributions and member letters.",
  basePath: "/administration",
  permission: "module.administration",
  nav: [
    { label: "Overview", href: "/administration" },
    { label: "Members", href: "/administration/members", permission: "members.read" },
    { label: "Approvals", href: "/administration/approvals", permission: "members.approve" },
    { label: "Maturities", href: "/administration/reports/maturities", permission: "members.read" },
    { label: "Targets", href: "/administration/targets", permission: "members.read" },
    { label: "Reports", href: "/administration/reports", permission: "members.read" },
  ],
};
