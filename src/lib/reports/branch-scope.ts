import type { PermissionSet } from "@/lib/auth/permissions";
import type { BranchRef } from "@/lib/org";
import type { ReportDefinition, ReportFilters } from "./types";

/** Lets a member of staff run Operations reports for every branch. Only the Head of Operations holds it. */
export const ALL_BRANCHES_PERMISSION = "reports.all_branches";

/**
 * The branches a member of staff may run a report for, or null when they may run it for every branch.
 *
 * Operations (Administration) reports are limited to the reader's own branch unless they hold reports.all_branches.
 * Their branch is the one their role is assigned to; a role given organisation-wide falls back to their home branch,
 * so it can't be used to read every branch's reports. Other departments' reports are left to row level security.
 */
export function reportBranches(
  report: Pick<ReportDefinition, "basePath" | "permission">,
  staff: { permissions: PermissionSet; homeBranchId: string | null },
  branches: readonly BranchRef[],
): BranchRef[] | null {
  if (report.basePath !== "/administration") return null;
  if (staff.permissions.has(ALL_BRANCHES_PERMISSION)) return null;
  const { permissions } = staff;
  return branches.filter((b) =>
    permissions.isOrganisationWide(report.permission)
      ? b.id === staff.homeBranchId
      : permissions.hasForBranch(report.permission, b),
  );
}

/**
 * Pins the filters to the allowed branches: the region filter is dropped and the branch is forced to one the reader
 * may see (the first, if none or another branch was asked for). Returns null when the reader has no branch at all.
 */
export function limitFiltersToBranches(filters: ReportFilters, allowed: readonly BranchRef[] | null): ReportFilters | null {
  if (allowed === null) return filters;
  if (allowed.length === 0) return null;
  const branch = allowed.some((b) => b.id === filters.branch) ? filters.branch : allowed[0].id;
  return { ...filters, branch, region: null };
}
