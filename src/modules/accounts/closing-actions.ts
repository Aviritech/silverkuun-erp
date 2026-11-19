"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { accountsModule } from "./module";

const closeSchema = z.object({
  note: z.string().trim().max(500, "Keep the note under 500 characters"),
  // The month the person saw on the page, so a page left open can't close a different month.
  month_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function runMonthEnd(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const parsed = closeSchema.safeParse({ note: formData.get("note") ?? "", month_end: formData.get("month_end") ?? "" });
  if (!parsed.success) return { fieldErrors: { note: parsed.error.issues[0]?.message ?? "Check the note" } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_month_end", { p_month_end: parsed.data.month_end, p_note: parsed.data.note || null });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/accounts", "layout");
  return { ok: true };
}
