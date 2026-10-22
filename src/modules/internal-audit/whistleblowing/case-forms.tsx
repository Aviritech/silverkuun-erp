"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field, FormError, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { CASE_STATUSES, type CaseStatus } from "./constants";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function CaseForm({
  action,
  current,
}: {
  action: Action;
  current: { status: CaseStatus; findings: string | null; outcome: string | null };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <div className="w-56">
        <Field label="Status" error={e.status}>
          <Select name="status" defaultValue={current.status}>
            {Object.entries(CASE_STATUSES).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Findings" error={e.findings} hint="Your working notes. The reporter never sees these.">
        <Textarea name="findings" rows={5} defaultValue={current.findings ?? ""} />
      </Field>
      <Field
        label="Outcome"
        error={e.outcome}
        hint="Needed to close the case. The reporter sees this once the case is resolved or dismissed, so write it for them."
      >
        <Textarea name="outcome" rows={3} defaultValue={current.outcome ?? ""} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.ok && state.message && <span className="text-sm text-emerald-700">{state.message}</span>}
      </div>
    </form>
  );
}

export function MessageForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={formAction} className="space-y-2">
      <FormError message={state.error} />
      <Field
        label="Send a message to the reporter"
        error={state.fieldErrors?.body}
        hint="They read it when they follow up with their reference and code. They aren't notified."
      >
        <Textarea name="body" rows={3} required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
