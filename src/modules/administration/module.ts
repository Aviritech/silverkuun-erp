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
    { section: "Workspace", label: "Top ups from Accounts", href: "/administration/top-ups", permission: "members.read" },
    {
      section: "Workspace",
      label: "Liquidations and roll-overs",
      href: "/administration/liquidations",
      permission: ["liquidations.request", "liquidations.approve"],
    },
    {
      section: "Workspace",
      label: "Special rates",
      href: "/administration/special-rates",
      permission: [
        "plans.rate.request",
        "plans.rate.approve_branch",
        "plans.rate.approve_operations",
        "plans.rate.approve_region",
        "plans.rate.approve_bdm",
        "plans.rate.approve_ceo",
      ],
    },
    { section: "Members", label: "Members", href: "/administration/members", permission: "members.read" },
    { section: "Members", label: "Maturities", href: "/administration/reports/maturities", permission: "members.read" },
    { section: "Members", label: "Targets", href: "/administration/targets", permission: "members.read" },
    { section: "Insight", label: "Reports", href: "/administration/reports", permission: "members.read" },
  ],
};
