"use client";

import { useActionState, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, FormError } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { SignaturePad } from "@/modules/signatures/components/signature-pad";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** The Branch Manager signs (drawn, or typed) to approve; the signature is saved with the approval. */
export function ApprovalForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [signed, setSigned] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [asking, setAsking] = useState(false);

  return (
    <form
      action={formAction}
      className="space-y-2"
      ref={form}
      onSubmit={(e) => {
        // Ask in a modal first; once confirmed, the form is submitted again and goes through.
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        e.preventDefault();
        setAsking(true);
      }}
    >
      <p className="text-xs text-zinc-500">Sign to approve</p>
      <SignaturePad onChange={setSigned} disabled={pending} />
      <FormError message={state.error ?? state.fieldErrors?.signature} />
      <Button type="submit" disabled={pending || !signed}>
        {pending ? "Approving…" : "Approve and sign"}
      </Button>
      <ConfirmDialog
        open={asking}
        message="Approve this member? A membership number will be issued and your signature recorded."
        confirmLabel="Approve and sign"
        onConfirm={() => {
          setAsking(false);
          confirmed.current = true;
          form.current?.requestSubmit();
        }}
        onCancel={() => setAsking(false)}
      />
    </form>
  );
}
