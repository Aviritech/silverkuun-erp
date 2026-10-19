"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui";

/** "Send this file? You can't edit it after." → heading "Send this file?", body "You can't edit it after." */
function splitMessage(message: string): [string, string] {
  const end = message.indexOf("?") + 1 || message.indexOf(". ") + 1;
  if (!end || end >= message.length) return [message, ""];
  return [message.slice(0, end).trim(), message.slice(end).trim()];
}

/**
 * An in-app confirmation modal, used instead of the browser's confirm() pop-up.
 * Built on <dialog>, so focus stays inside it and Esc or a click on the backdrop cancels.
 */
export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [title, body] = splitMessage(message);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-zinc-200 bg-white p-0 text-left text-zinc-900 shadow-2xl backdrop:bg-ink/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
              tone === "danger" ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-ink text-silver-200"
            }`}
          >
            {tone === "danger" ? "!" : "?"}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {body && <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{body}</p>}
          </div>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-zinc-100 bg-silver-50 px-6 py-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} autoFocus>
          Cancel
        </Button>
        <Button type="button" variant={tone} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
