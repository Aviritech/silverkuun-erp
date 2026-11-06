/**
 * A department module. Each department lives in src/modules/<department>/ with its own pages,
 * database migration and permissions, and registers itself in src/modules/registry.ts.
 */
export type ModuleNavItem = {
  label: string;
  href: string;
  /** Hide the link unless the staff member holds this permission (or, given a list, any of them). */
  permission?: string | readonly string[];
  /** A sub-heading the link sits under in the sidebar (for example "Finance"); consecutive links share it. */
  section?: string;
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
