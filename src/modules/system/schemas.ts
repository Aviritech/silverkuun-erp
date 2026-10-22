import { z } from "zod";

const code = (what: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, `Use 2 to 10 letters or digits for the ${what} code`);

export const newStaffSchema = z.object({
  full_name: z.string().trim().min(3, "Enter their full name"),
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  department_code: z.string().min(1, "Choose a department"),
  home_branch_id: z.guid("Choose a branch").nullable().or(z.literal("").transform(() => null)),
});

export const grantRoleSchema = z
  .object({
    role_code: z.string().min(1, "Choose a role"),
    scope: z.enum(["organisation", "region", "branch"], "Choose where the role applies"),
    region_id: z.string(),
    branch_id: z.string(),
  })
  .refine((v) => v.scope !== "region" || z.guid().safeParse(v.region_id).success, { path: ["region_id"], message: "Choose a region" })
  .refine((v) => v.scope !== "branch" || z.guid().safeParse(v.branch_id).success, { path: ["branch_id"], message: "Choose a branch" })
  .transform((v) => ({
    role_code: v.role_code,
    region_id: v.scope === "region" ? v.region_id : null,
    branch_id: v.scope === "branch" ? v.branch_id : null,
  }));

export const regionSchema = z.object({
  code: code("region"),
  name: z.string().trim().min(2, "Enter the region's name"),
});

export const branchSchema = z.object({
  region_id: z.guid("Choose a region"),
  code: code("branch"),
  name: z.string().trim().min(2, "Enter the branch's name"),
});

export const departmentSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,30}$/, "Use lowercase letters, digits and underscores, starting with a letter"),
  name: z.string().trim().min(2, "Enter the department's name"),
});
