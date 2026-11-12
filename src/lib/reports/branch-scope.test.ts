import { describe, expect, it } from "vitest";
import { PermissionSet, type PermissionGrant } from "@/lib/auth/permissions";
import { limitFiltersToBranches, reportBranches } from "./branch-scope";
import type { ReportFilters } from "./types";

const lagos = { id: "b-lagos", code: "LAG", name: "Lagos", region_id: "r-sw" };
const ibadan = { id: "b-ibadan", code: "IBA", name: "Ibadan", region_id: "r-sw" };
const abuja = { id: "b-abuja", code: "ABJ", name: "Abuja", region_id: "r-nc" };
const branches = [abuja, ibadan, lagos];

const ops = { basePath: "/administration" as const, permission: "members.read" };
const staff = (grants: PermissionGrant[], homeBranchId: string | null = null) => ({
  permissions: new PermissionSet(grants),
  homeBranchId,
});
const read = (branch_id: string | null, region_id: string | null = null) => ({ permission_code: "members.read", branch_id, region_id });
const filters: ReportFilters = { from: "2026-01-01", to: "2026-11-11", branch: null, region: "r-nc", department: null, product: null, options: {} };

describe("reportBranches", () => {
  it("lets the Head of Operations see every branch", () => {
    const head = staff([read(null), { permission_code: "reports.all_branches", branch_id: null, region_id: null }], lagos.id);
    expect(reportBranches(ops, head, branches)).toBeNull();
  });

  it("limits a branch officer to the branch their role is assigned to", () => {
    expect(reportBranches(ops, staff([read(lagos.id)], abuja.id), branches)).toEqual([lagos]);
  });

  it("limits an organisation-wide role without reports.all_branches to the home branch", () => {
    expect(reportBranches(ops, staff([read(null)], ibadan.id), branches)).toEqual([ibadan]);
    expect(reportBranches(ops, staff([read(null)], null), branches)).toEqual([]);
  });

  it("leaves other departments' reports to row level security", () => {
    expect(reportBranches({ basePath: "/accounts", permission: "members.read" }, staff([read(lagos.id)]), branches)).toBeNull();
  });
});

describe("limitFiltersToBranches", () => {
  it("forces the branch filter to an allowed branch and drops the region", () => {
    expect(limitFiltersToBranches(filters, [lagos])).toMatchObject({ branch: lagos.id, region: null });
    expect(limitFiltersToBranches({ ...filters, branch: abuja.id }, [lagos])).toMatchObject({ branch: lagos.id });
    expect(limitFiltersToBranches({ ...filters, branch: ibadan.id }, [lagos, ibadan])).toMatchObject({ branch: ibadan.id });
  });

  it("returns nothing for a reader with no branch, and leaves unlimited readers alone", () => {
    expect(limitFiltersToBranches(filters, [])).toBeNull();
    expect(limitFiltersToBranches(filters, null)).toBe(filters);
  });
});
