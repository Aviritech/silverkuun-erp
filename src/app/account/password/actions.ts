"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z.string().min(10, "Use at least 10 characters").max(72, "Use at most 72 characters"),
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, { path: ["confirm_password"], message: "The passwords don't match" })
  .refine((v) => v.new_password !== v.current_password, { path: ["new_password"], message: "Choose a different password" });

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = passwordSchema.safeParse({
    current_password: formData.get("current_password") ?? "",
    new_password: formData.get("new_password") ?? "",
    confirm_password: formData.get("confirm_password") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  // Signing in again proves the current password before it is replaced.
  const check = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.data.current_password });
  if (check.error) return { fieldErrors: { current_password: "That isn't your current password" } };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.new_password });
  if (error) return { error: error.message };

  const cleared = await supabase.rpc("password_changed");
  if (cleared.error) return { error: friendlyDbError(cleared.error) };

  redirect("/");
}
