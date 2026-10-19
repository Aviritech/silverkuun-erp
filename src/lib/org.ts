import "server-only";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";

export type BranchRef = { id: string; code: string; name: string; region_id: string };
export type RegionRef = { id: string; code: string; name: string };

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
