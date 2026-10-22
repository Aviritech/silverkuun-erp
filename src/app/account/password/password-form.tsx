"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

export function PasswordForm({ action }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <Field label="Current password" error={e.current_password}>
        <Input name="current_password" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" error={e.new_password} hint="At least 10 characters">
        <Input name="new_password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field label="New password again" error={e.confirm_password}>
        <Input name="confirm_password" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
