"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { SIGNER_ROLES, type SignerRole } from "../constants";
import { SignaturePad } from "./signature-pad";

/**
 * "Sign electronically": who is signing, their signature (drawn or typed) and their agreement to sign this way.
 * `names` pre-fills the signer's name for a role, such as the member's name; a staff member signs under their own login.
 */
export function ESignForm({
  action,
  roles,
  names = {},
  label = "Sign electronically",
  what = "this document",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  roles: SignerRole[];
  names?: Partial<Record<SignerRole, string>>;
  label?: string;
  /** What is being signed, for the agreement line. */
  what?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const [role, setRole] = useState<SignerRole>(roles[0]);
  const [name, setName] = useState(names[roles[0]] ?? "");
  const [signed, setSigned] = useState(false);
  const [padKey, setPadKey] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      form.current?.reset();
      setOpen(false);
      setSigned(false);
      setPadKey((k) => k + 1);
    }
  }, [state]);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  const errors = state.fieldErrors ?? {};
  const self = role === "staff";
  return (
    <form ref={form} action={formAction} className="w-full space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {roles.length > 1 ? (
          <Field label="Who is signing" error={errors.signer_role}>
            <Select
              name="signer_role"
              value={role}
              onChange={(e) => {
                const next = e.target.value as SignerRole;
                setRole(next);
                setName(names[next] ?? "");
              }}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {SIGNER_ROLES[r]}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="signer_role" value={role} />
        )}
        {self ? (
          <input type="hidden" name="signer_name" value="" />
        ) : (
          <Field label="Signer's full name" error={errors.signer_name}>
            <Input name="signer_name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} readOnly={role === "guarantor" && roles.length === 1} />
          </Field>
        )}
      </div>
      <SignaturePad key={padKey} onChange={setSigned} disabled={pending} />
      {errors.signature && <p className="text-xs text-red-700">{errors.signature}</p>}
      <label className="flex items-start gap-2 text-sm text-zinc-700">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>
          {self
            ? `I am signing ${what} electronically, and this is my signature.`
            : `The signer is here in person, has read ${what}, and agrees to sign it electronically.`}
        </span>
      </label>
      {errors.consent && <p className="text-xs text-red-700">{errors.consent}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !signed}>
          {pending ? "Saving…" : "Save signature"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
