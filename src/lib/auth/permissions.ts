/** One permission the staff member holds, and where it applies. Mirrors public.my_permissions(). */
export type PermissionGrant = {
  permission_code: string;
  branch_id: string | null;
  region_id: string | null;
};

export class PermissionSet {
  constructor(private readonly grants: readonly PermissionGrant[]) {}

  /** Held anywhere: organisation-wide, for a region, or for a branch. */
  has(permission: string): boolean {
    return this.grants.some((g) => g.permission_code === permission);
  }

  /** Held for this branch, directly, through its region, or organisation-wide. */
  hasForBranch(permission: string, branch: { id: string; region_id: string }): boolean {
    return this.grants.some(
      (g) =>
        g.permission_code === permission &&
        ((g.branch_id === null && g.region_id === null) || g.branch_id === branch.id || g.region_id === branch.region_id),
    );
  }

  /** Held organisation-wide rather than for particular branches or regions. */
  isOrganisationWide(permission: string): boolean {
    return this.grants.some((g) => g.permission_code === permission && g.branch_id === null && g.region_id === null);
  }
}
