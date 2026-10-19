"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { ActionState } from "../actions";

/** A button that runs a server action, asks for confirmation if needed, and shows any error beside it. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  confirm,
  variant,
}: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(undefined);
          start(async () => {
            const result = await action();
            if (result.error) setError(result.error);
          });
        }}
      >
        {pending ? (pendingLabel ?? "Working…") : label}
      </Button>
      {error && <span className="max-w-xs text-xs text-red-700">{error}</span>}
    </span>
  );
}
