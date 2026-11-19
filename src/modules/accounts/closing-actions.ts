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
  // The date the person saw on the page, so a day closed meanwhile by someone else (or the system) isn't closed twice.
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function runEndOfDay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const parsed = closeSchema.safeParse({ note: formData.get("note") ?? "", business_date: formData.get("business_date") ?? "" });
  if (!parsed.success) return { fieldErrors: { note: parsed.error.issues[0]?.message ?? "Check the note" } };
  const supabase = await createClient();
  const { data: open } = await supabase.rpc("business_date_status");
  const current = (open as { business_date: string | null }[] | null)?.[0]?.business_date;
  if (current !== parsed.data.business_date) {
    revalidatePath("/accounts/closing");
    return { error: "That day has already been closed. The page now shows the next business day." };
  }
  const { error } = await supabase.rpc("run_end_of_day", { p_note: parsed.data.note || null });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

const settingsSchema = z.object({
  auto_close: z.enum(["on", "off"]),
  auto_close_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Give a time such as 23:00"),
});

export async function saveDayEndSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule(accountsModule);
  const parsed = settingsSchema.safeParse({ auto_close: formData.get("auto_close") ?? "", auto_close_at: formData.get("auto_close_at") ?? "" });
  if (!parsed.success) return { fieldErrors: { auto_close_at: parsed.error.issues[0]?.message ?? "Check the time" } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_day_end_settings", {
    p_auto_close: parsed.data.auto_close === "on",
    p_auto_close_at: parsed.data.auto_close_at,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/accounts/closing");
  return { ok: true };
}
