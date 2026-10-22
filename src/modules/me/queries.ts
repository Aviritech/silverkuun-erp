import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getCurrentStaff, type CurrentStaff } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { Employee } from "@/modules/hr/queries";

/** The signed-in staff member's own employee record, or null when their login isn't linked to one. */
export const getMyEmployee = cache(async (): Promise<Employee | null> => {
  const staff = await getCurrentStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").select("*").eq("staff_id", staff.id).maybeSingle();
  if (error) throw dbFailure(error);
  return data as Employee | null;
});

/** For "My HR" pages that need an employee record. Returns 404 for logins that aren't linked to one. */
export async function requireMyEmployee(): Promise<{ staff: CurrentStaff; employee: Employee }> {
  const [staff, employee] = await Promise.all([getCurrentStaff(), getMyEmployee()]);
  if (!employee) notFound();
  return { staff, employee };
}
