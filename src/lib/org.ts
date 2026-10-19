import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";

export type BranchRef = { id: string; code: string; name: string; region_id: string };
export type RegionRef = { id: string; code: string; name: string };
export type CodeRef = { code: string; name: string };

/** Branches and regions, for filters and labels. Readable by every signed-in staff member. */
export async function listOrg(): Promise<{ branches: BranchRef[]; regions: RegionRef[] }> {
  const supabase = await createClient();
  const [branches, regions] = await Promise.all([
    supabase.from("branches").select("id, code, name, region_id").order("name"),
    supabase.from("regions").select("id, code, name").order("name"),
  ]);
  if (branches.error) throw dbFailure(branches.error);
  if (regions.error) throw dbFailure(regions.error);
  return { branches: branches.data, regions: regions.data };
}

/** Departments and savings products, the reporting dimensions besides branch and region. */
export async function listDimensions(): Promise<{ departments: CodeRef[]; products: CodeRef[] }> {
  const supabase = await createClient();
  const [departments, products] = await Promise.all([
    supabase.from("departments").select("code, name").order("name"),
    supabase.from("plan_types").select("code, name").order("sort_order"),
  ]);
  if (departments.error) throw dbFailure(departments.error);
  if (products.error) throw dbFailure(products.error);
  return { departments: departments.data, products: products.data };
}
