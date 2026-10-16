import { describe, expect, it } from "vitest";
import { PermissionSet } from "./permissions";

const lagos = { id: "b-lagos", region_id: "r-sw" };
const ibadan = { id: "b-ibadan", region_id: "r-sw" };
const abuja = { id: "b-abuja", region_id: "r-nc" };

describe("PermissionSet", () => {
  it("scopes a branch grant to that branch", () => {
    const perms = new PermissionSet([{ permission_code: "members.approve", branch_id: lagos.id, region_id: null }]);
    expect(perms.hasForBranch("members.approve", lagos)).toBe(true);
    expect(perms.hasForBranch("members.approve", ibadan)).toBe(false);
  });

  it("scopes a region grant to the region's branches", () => {
    const perms = new PermissionSet([{ permission_code: "members.read", branch_id: null, region_id: "r-sw" }]);
    expect(perms.hasForBranch("members.read", ibadan)).toBe(true);
    expect(perms.hasForBranch("members.read", abuja)).toBe(false);
    expect(perms.isOrganisationWide("members.read")).toBe(false);
  });

  it("applies an organisation-wide grant everywhere", () => {
    const perms = new PermissionSet([{ permission_code: "audit.trail.read", branch_id: null, region_id: null }]);
    expect(perms.hasForBranch("audit.trail.read", abuja)).toBe(true);
    expect(perms.isOrganisationWide("audit.trail.read")).toBe(true);
  });

  it("grants nothing it was not given", () => {
    expect(new PermissionSet([]).has("module.administration")).toBe(false);
  });
});
