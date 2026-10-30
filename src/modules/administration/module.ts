import type { DepartmentModule } from "../types";

export const administrationModule: DepartmentModule = {
  department: "administration",
  name: "Operations",
  description: "Member onboarding, approvals, contributions and member letters.",
  basePath: "/administration",
  permission: "module.administration",
  nav: [
    { label: "Overview", href: "/administration" },
    { label: "Members", href: "/administration/members", permission: "members.read" },
    { label: "Approvals", href: "/administration/approvals", permission: ["members.approve", "members.endorse"] },
    { label: "Receipts to check", href: "/administration/receipts", permission: "receipts.confirm" },
    { label: "Maturities", href: "/administration/reports/maturities", permission: "members.read" },
    { label: "Targets", href: "/administration/targets", permission: "members.read" },
    { label: "Reports", href: "/administration/reports", permission: "members.read" },
  ],
};
