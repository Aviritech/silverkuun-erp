"use client";

import { createClient } from "@supabase/supabase-js";
import { useState } from "react";
import { Field, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { publicEnv } from "@/lib/env";
import { MemberForm } from "@/modules/administration/components/member-form";
import type { CbnBank, Member } from "@/modules/administration/queries";
import { CLIENT_DOCUMENTS, SIGNUP_BUCKET, SIGNUP_MAX_BYTES, SIGNUP_TYPES, type ClientDocument } from "../constants";
import { prepareSignupUploads, submitFix, submitSignup } from "../signup-actions";
import type { FixLinkDocument } from "../signup";

const KEYS = Object.keys(CLIENT_DOCUMENTS) as ClientDocument[];

/**
 * The client's own member form. Chosen files go straight from the browser to a private bucket through one-time signed
 * upload URLs (Vercel refuses request bodies over 4.5 MB); the form then sends only a reference to each file, and the
 * server checks every file before moving it into the member's folder.
 */
export function SignupForm({
  token,
  banks,
  staffName,
  fix,
}: {
  token: string;
  banks: CbnBank[];
  staffName: string;
  /** Set when the client is correcting a returned file: their answers so far, and the documents already on file. */
  fix?: { member: Partial<Member>; documents: FixLinkDocument[] };
}) {
  const [done, setDone] = useState(false);

  async function action(prev: ActionState, formData: FormData): Promise<ActionState> {
    const chosen = KEYS.map((key) => [key, formData.get(`doc_${key}`)] as const).filter(
      (entry): entry is readonly [ClientDocument, File] => entry[1] instanceof File && entry[1].size > 0,
    );
    for (const [key, value] of [...formData.entries()]) if (value instanceof File) formData.delete(key);

    for (const [key, file] of chosen) {
      if (!(SIGNUP_TYPES as readonly string[]).includes(file.type)) return { fieldErrors: { [`doc_${key}`]: "Upload a PDF, JPEG or PNG" } };
      if (file.size > SIGNUP_MAX_BYTES) return { fieldErrors: { [`doc_${key}`]: "Files can be at most 10 MB" } };
    }

    if (chosen.length) {
      const prepared = await prepareSignupUploads(
        token,
        chosen.map(([key, file]) => ({ document_type: key, name: file.name, type: file.type, size: file.size })),
        fix ? "fix" : "signup",
      );
      if (prepared.error || prepared.fieldErrors) return { error: prepared.error, fieldErrors: prepared.fieldErrors };
      const env = publicEnv();
      const storage = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      }).storage.from(SIGNUP_BUCKET);
      for (const ticket of prepared.tickets ?? []) {
        const file = chosen.find(([key]) => key === ticket.document_type)![1];
        const { error } = await storage.uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
        if (error) {
          return { fieldErrors: { [`doc_${ticket.document_type}`]: "This file couldn't be uploaded. Check your connection and try again." } };
        }
        formData.set(`doc_${ticket.document_type}`, JSON.stringify({ path: ticket.path, name: file.name, type: file.type }));
      }
    }

    const result = fix ? await submitFix(token, prev, formData) : await submitSignup(token, prev, formData);
    if (result.ok) setDone(true);
    return result;
  }

  if (done) {
    return (
      <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-6 text-green-900">
        <h2 className="text-lg font-semibold">{fix ? "Thank you. Your corrected form has been sent." : "Thank you. Your form has been sent."}</h2>
        <p className="mt-2 text-sm">
          {fix ? "Silverkuun staff will check it again" : `${staffName} will confirm your details`}, then a Silverkuun officer completes your file and the Branch Manager approves your
          membership. They will contact you if anything else is needed. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <MemberForm
      action={action}
      banks={banks}
      member={fix?.member}
      submitLabel={fix ? "Send my corrected form" : "Send my form"}
      pendingLabel="Sending…"
    >
      {(e) => (
        <>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-semibold text-zinc-700">Your documents</legend>
            <p className="text-xs text-zinc-500 sm:col-span-2">
              {fix
                ? "Choose a file only to replace the one we have, or to add one that is missing. A clear photo or PDF, at most 10 MB."
                : "Optional, but it speeds things up. A clear photo or PDF of each, at most 10 MB. The officer can collect anything you leave out."}
            </p>
            {KEYS.map((key) => {
              const onFile = fix?.documents.filter((d) => d.document_type === key) ?? [];
              return (
                <Field
                  key={key}
                  label={CLIENT_DOCUMENTS[key]}
                  error={e[`doc_${key}`]}
                  hint={fix ? (onFile.length ? `On file: ${onFile.map((d) => d.file_name).join(", ")}. A new file replaces it.` : "Not on file yet") : undefined}
                >
                  <Input name={`doc_${key}`} type="file" accept={SIGNUP_TYPES.join(",")} />
                </Field>
              );
            })}
          </fieldset>
          <Field label="Confirmation" error={e.consent}>
            <span className="mt-1 flex items-start gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="consent" value="yes" required className="mt-1" />
              <span>
                These details are mine and correct, and I agree that Silverkuun may use them to open and manage my membership.
              </span>
            </span>
          </Field>
        </>
      )}
    </MemberForm>
  );
}
