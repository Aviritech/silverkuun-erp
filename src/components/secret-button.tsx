"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

/**
 * Runs a server action that hands back something to show once, such as a temporary password.
 * The secret lives only in this component's state: it disappears when the page is left or reloaded.
 */
export function SecretButton({
  action,
  label,
  pendingLabel,
  confirm,
  variant = "primary",
}: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);

  function run() {
    setAsking(false);
    setResult({});
    start(async () => setResult(await action()));
  }

  async function copy() {
    if (!result.secret) return;
    await navigator.clipboard.writeText(result.secret);
    setCopied(true);
  }

  return (
    <div className="space-y-3">
      {!result.ok && (
        <Button type="button" variant={variant} disabled={pending} onClick={() => (confirm ? setAsking(true) : run())}>
          {pending ? (pendingLabel ?? "Working…") : label}
        </Button>
      )}
      {result.error && <p className="text-sm text-red-700">{result.error}</p>}
      {result.ok && result.message && <p className="text-sm text-zinc-700">{result.message}</p>}
      {result.secret && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <code className="select-all font-mono text-lg tracking-wider text-ink">{result.secret}</code>
          <Button type="button" variant="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <span className="text-xs text-amber-900">Shown only once. It isn&apos;t stored anywhere.</span>
        </div>
      )}
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
    </div>
  );
}
