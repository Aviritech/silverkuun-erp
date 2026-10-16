"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, FormError } from "@/components/ui";
import type { ActionState } from "../actions";

/**
 * A form hidden behind a button: opens on click, closes after a successful save.
 * `children` receives the field errors so each field can show its own message.
 */
export function InlineForm({
  action,
  openLabel,
  submitLabel,
  variant = "secondary",
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  openLabel: string;
  submitLabel: string;
  variant?: "primary" | "secondary" | "danger";
  children: (errors: Record<string, string>) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      form.current?.reset();
      setOpen(false);
    }
  }, [state]);

  if (!open) {
    return (
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {openLabel}
      </Button>
    );
  }

  return (
    <form ref={form} action={formAction} className="w-full space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <FormError message={state.error} />
      {children(state.fieldErrors ?? {})}
      <div className="flex gap-2">
        <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
