import type { ModuleNavItem } from "../types";

/**
 * "My HR": every employee's own leave, payslips, reviews, training and commission. Shown to anyone whose login is
 * linked to an employee record; "Speak up" is shown to every signed-in staff member.
 */
export const myHrNav: ModuleNavItem[] = [
  { label: "My overview", href: "/me" },
  { label: "My leave", href: "/me/leave" },
  { label: "Approvals", href: "/me/approvals" },
  { label: "Payslips", href: "/me/payslips" },
  { label: "My performance", href: "/me/performance" },
  { label: "My training", href: "/me/training" },
  { label: "My commission", href: "/me/commission" },
];

export const speakUpNav: ModuleNavItem = { label: "Speak up", href: "/me/speak-up" };
