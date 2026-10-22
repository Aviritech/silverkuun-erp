"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { Badge, Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { lookUpCase, replyToCase, submitReport } from "./actions";
import { CASE_STATUSES, SPEAK_UP_CATEGORIES, type ReporterCase } from "./constants";

const today = () => new Date().toISOString().slice(0, 10);

/** The reference and code, shown once after a report is made. */
function Receipt({ reference, code }: { reference: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(`Reference: ${reference}\nAccess code: ${code}`);
    setCopied(true);
  }
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="font-medium text-ink">Your report has been sent to Internal Audit.</p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-amber-900">Reference</dt>
          <dd className="select-all font-mono text-lg tracking-wider text-ink">{reference}</dd>
        </div>
        <div>
          <dt className="text-xs text-amber-900">Access code</dt>
          <dd className="select-all font-mono text-lg tracking-wider text-ink">{code}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy both"}
        </Button>
        <span className="text-sm text-amber-900">
          Write these down; you need both to follow up. They are shown only once and can&apos;t be recovered.
        </span>
      </div>
    </div>
  );
}

export function SpeakUpForm() {
  const [state, formAction, pending] = useActionState(submitReport, {});
  const [anonymous, setAnonymous] = useState(true);
  const e = state.fieldErrors ?? {};

  if (state.ok && state.message && state.secret) return <Receipt reference={state.message} code={state.secret} />;

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What is it about?" error={e.category}>
          <Select name="category" defaultValue="" required>
            <option value="">Choose</option>
            {Object.entries(SPEAK_UP_CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" error={e.title} hint="A few words, such as “Cash missing from the till”">
          <Input name="title" maxLength={200} required />
        </Field>
      </div>
      <Field label="What happened?" error={e.description} hint="What you saw or know, when, and how you know it. Facts help most.">
        <Textarea name="description" rows={6} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="When (if you know)" error={e.incident_date}>
          <Input name="incident_date" type="date" max={today()} />
        </Field>
        <Field label="Where" error={e.location} hint="Branch, office or place">
          <Input name="location" />
        </Field>
        <Field label="People involved" error={e.people_involved}>
          <Input name="people_involved" />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="anonymous"
          checked={anonymous}
          onChange={(ev) => setAnonymous(ev.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300"
        />
        <span>
          <span className="font-medium">Send anonymously</span>
          <span className="block text-zinc-600">
            {anonymous
              ? "Nothing about who you are is stored with the report."
              : "Internal Audit will see your name with the report."}
          </span>
        </span>
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send report"}
      </Button>
    </form>
  );
}

/** Follows a report up. The reference and code live only in this component's state, never in the URL. */
export function FollowUp() {
  const [reference, setReference] = useState("");
  const [code, setCode] = useState("");
  const [found, setFound] = useState<ReporterCase | null>(null);
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const reply = useRef<HTMLTextAreaElement>(null);

  function look(event?: FormEvent) {
    event?.preventDefault();
    setError(undefined);
    setErrors({});
    start(async () => {
      const result = await lookUpCase(reference, code);
      setError(result.error);
      setErrors(result.fieldErrors ?? {});
      setFound(result.case ?? null);
    });
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const body = reply.current?.value ?? "";
    setError(undefined);
    setErrors({});
    start(async () => {
      const result = await replyToCase(reference, code, body);
      if (result.error || result.fieldErrors) {
        setError(result.error);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      if (reply.current) reply.current.value = "";
      const refreshed = await lookUpCase(reference, code);
      if (refreshed.case) setFound(refreshed.case);
    });
  }

  function close() {
    setFound(null);
    setReference("");
    setCode("");
  }

  if (!found) {
    return (
      <form onSubmit={look} className="space-y-4" autoComplete="off">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reference" error={errors.reference}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="SU-1A2B3C4D" required />
          </Field>
          <Field label="Access code" error={errors.code}>
            <Input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="1A2B-3C4D-5E6F"
              autoComplete="off"
              required
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Looking…" : "Open my report"}
        </Button>
      </form>
    );
  }

  const status = CASE_STATUSES[found.status];
  const closed = found.status === "resolved" || found.status === "dismissed";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{found.title}</p>
          <p className="text-sm text-zinc-600">
            <span className="font-mono">{found.reference}</span> · sent {formatDate(found.received_on)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={status.tone}>{status.reporterLabel}</Badge>
          <Button type="button" variant="secondary" onClick={close}>
            Close
          </Button>
        </div>
      </div>

      {closed && found.outcome && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
          <p className="text-xs text-zinc-500">Outcome ({formatDate(found.closed_on)})</p>
          <p className="mt-1 whitespace-pre-wrap">{found.outcome}</p>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-zinc-800">Messages</p>
        {found.messages.length === 0 ? (
          <p className="text-sm text-zinc-500">No messages yet. Internal Audit may write here if they have questions.</p>
        ) : (
          <ul className="space-y-2">
            {found.messages.map((m, i) => (
              <li
                key={i}
                className={`max-w-xl rounded-lg px-3 py-2 text-sm ${m.from_reporter ? "ml-auto bg-ink text-white" : "bg-zinc-100 text-zinc-900"}`}
              >
                <p className={`text-xs ${m.from_reporter ? "text-silver-200" : "text-zinc-500"}`}>
                  {m.from_reporter ? "You" : "Internal Audit"} · {formatDate(m.sent_on)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={send} className="space-y-2">
        <FormError message={error} />
        <Field label="Reply to Internal Audit" error={errors.body}>
          <Textarea ref={reply} rows={3} required />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send reply"}
        </Button>
      </form>
    </div>
  );
}
