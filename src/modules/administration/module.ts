import type { DepartmentModule } from "../types";

export const administrationModule: DepartmentModule = {
  department: "administration",
  name: "Operations",
  description: "Member onboarding, approvals, contributions and member letters.",
  basePath: "/administration",
  permission: "module.administration",
  nav: [
    { section: "Workspace", label: "Overview", href: "/administration" },
    { section: "Workspace", label: "Approvals", href: "/administration/approvals", permission: ["members.approve", "members.endorse"] },
    { section: "Workspace", label: "Receipts to check", href: "/administration/receipts", permission: "receipts.confirm" },
    { section: "Workspace", label: "Liquidations", href: "/administration/liquidations", permission: ["liquidations.request", "liquidations.approve"] },
    { section: "Members", label: "Members", href: "/administration/members", permission: "members.read" },
    { section: "Members", label: "Maturities", href: "/administration/reports/maturities", permission: "members.read" },
    { section: "Members", label: "Targets", href: "/administration/targets", permission: "members.read" },
    { section: "Insight", label: "Reports", href: "/administration/reports", permission: "members.read" },
  ],
};
