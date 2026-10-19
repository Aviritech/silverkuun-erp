"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

/** A button that runs a server action, asks for confirmation if needed, and shows any error beside it. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  confirm,
  variant,
  disabled = false,
  title,
}: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger";
  /** Shows the button greyed out, e.g. until a precondition is met. */
  disabled?: boolean;
  /** Hover text, useful for saying why the button is disabled. */
  title?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState(false);

  function run() {
    setAsking(false);
    setError(undefined);
    start(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        disabled={disabled || pending}
        title={title}
        onClick={() => (confirm ? setAsking(true) : run())}
      >
        {pending ? (pendingLabel ?? "Working…") : label}
      </Button>
      {error && <span className="max-w-xs text-xs text-red-700">{error}</span>}
      {confirm && (
        <ConfirmDialog
          open={asking}
          message={confirm}
          confirmLabel={label}
          tone={variant === "danger" ? "danger" : "primary"}
          onConfirm={run}
          onCancel={() => setAsking(false)}
        />
      )}
    </span>
  );
}
