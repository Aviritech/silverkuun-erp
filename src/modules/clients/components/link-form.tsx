"use client";

import { useState } from "react";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { useFormAction } from "@/lib/use-form-action";
import { LINK_DAYS } from "../constants";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Creates a sign-up link and shows it once, with buttons to copy it or send it on WhatsApp. */
export function LinkForm({
  action,
  branches,
  defaultBranchId,
}: {
  action: Action;
  branches: { id: string; name: string }[];
  defaultBranchId: string | null;
}) {
  const [state, onSubmit, pending] = useFormAction(action, {});
  const e = state.fieldErrors ?? {};
  const link = state.ok ? state.secret : undefined;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={state.error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Client's name (optional)" error={e.client_name} hint="Only for you and the welcome line">
            <Input name="client_name" maxLength={120} placeholder="e.g. Ada Obi" />
          </Field>
          <Field label="Branch they will join" error={e.branch_id}>
            <Select name="branch_id" required defaultValue={defaultBranchId ?? ""}>
              <option value="">Choose a branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Link works for" error={e.days}>
            <Select name="days" defaultValue="3">
              {LINK_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? "1 day" : `${d} days`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create link"}
        </Button>
      </form>

      {link && <ShareLink key={link} link={link} intro="Send this link to your client. It is shown only once and works one time." message="Please fill in your Silverkuun membership form here:" />}
    </div>
  );
}

/** A link shown once, with buttons to copy it or send it on WhatsApp. */
export function ShareLink({ link, intro, message }: { link: string; intro: string; message: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-xl border border-brand-300 bg-brand-50 p-4">
      <p className="text-sm font-medium text-ink">{intro}</p>
      <p className="mt-2 break-all rounded-md bg-white p-2 font-mono text-xs ring-1 ring-zinc-200">{link}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`${message} ${link}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-zinc-50"
        >
          Send on WhatsApp
        </a>
      </div>
    </div>
  );
}

/** Sends a returned sign-up back to the client: creates a one-time link to their form, shown once. */
export function FixLinkForm({ action }: { action: Action }) {
  const [state, onSubmit, pending] = useFormAction(action, {});
  const e = state.fieldErrors ?? {};
  const link = state.ok ? state.secret : undefined;
  return (
    <div className="space-y-4">
      <FormError message={state.error} />
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <Field label="Link works for" error={e.days}>
          <Select name="days" defaultValue="3">
            {LINK_DAYS.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1 day" : `${d} days`}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : link ? "Create a new link" : "Create link for the client"}
        </Button>
      </form>
      {link && (
        <ShareLink
          key={link}
          link={link}
          intro="Send this link to your client. It opens their form with their answers and the reason it came back. It is shown only once, works one time, and replaces any earlier link for this file."
          message="Silverkuun needs a correction to your membership form. Please open it here:"
        />
      )}
    </div>
  );
}
