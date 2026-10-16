/**
 * A department module. Each department lives in src/modules/<department>/ with its own pages,
 * database migration and permissions, and registers itself in src/modules/registry.ts.
 */
export type ModuleNavItem = {
  label: string;
  href: string;
  /** Hide the link unless the staff member holds this permission. */
  permission?: string;
};

export type DepartmentModule = {
  /** Matches public.departments.code. */
  department: string;
  name: string;
  description: string;
  basePath: `/${string}`;
  /** Needed to see or open the module at all. */
  permission: `module.${string}`;
  nav: ModuleNavItem[];
};
