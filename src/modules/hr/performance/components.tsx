"use client";

import { useActionState, useId } from "react";
import { InlineForm } from "@/components/inline-form";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { GOAL_TYPES, SCORE_LABELS, SUGGESTED_CRITERIA } from "./constants";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type PersonOption = { id: string; label: string };

function PeopleSelect({ people }: { people: PersonOption[] }) {
  return (
    <Select name="employee_id" defaultValue="" required>
      <option value="">Choose</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}

export function NewReviewForm({ action, people }: { action: Action; people: PersonOption[] }) {
  return (
    <InlineForm action={action} openLabel="New review" submitLabel="Start review" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" error={e.employee_id}>
            <PeopleSelect people={people} />
          </Field>
          <Field label="Period" error={e.period_label} hint="For example Q1 2026 or 2026 annual review">
            <Input name="period_label" required maxLength={60} />
          </Field>
          <Field label="From" error={e.period_start}>
            <Input name="period_start" type="date" required />
          </Field>
          <Field label="To" error={e.period_end}>
            <Input name="period_end" type="date" required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function ScoreForm({
  action,
  openLabel,
  initial,
}: {
  action: Action;
  openLabel: string;
  initial?: { criterion: string; target: string | null; actual: string | null; score: number; comment: string | null };
}) {
  const listId = useId();
  return (
    <InlineForm action={action} openLabel={openLabel} submitLabel={initial ? "Save" : "Add score"} variant={initial ? "secondary" : "primary"}>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Criterion" error={e.criterion}>
            <Input name="criterion" list={listId} defaultValue={initial?.criterion} required maxLength={120} />
            <datalist id={listId}>
              {SUGGESTED_CRITERIA.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Score" error={e.score}>
            <Select name="score" defaultValue={initial ? String(initial.score) : ""} required>
              <option value="">Choose</option>
              {Object.entries(SCORE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target" error={e.target} hint="Optional, for example 20 loans a month">
            <Input name="target" defaultValue={initial?.target ?? ""} />
          </Field>
          <Field label="Achieved" error={e.actual}>
            <Input name="actual" defaultValue={initial?.actual ?? ""} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Comment" error={e.comment}>
              <Input name="comment" defaultValue={initial?.comment ?? ""} />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function ReviewNotesForm({
  action,
  initial,
}: {
  action: Action;
  initial: { strengths: string | null; improvements: string | null; reviewer_comments: string | null; next_review_date: string | null };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.error} />
      <Field label="Strengths" error={e.strengths}>
        <Textarea name="strengths" rows={3} defaultValue={initial.strengths ?? ""} />
      </Field>
      <Field label="Areas to improve" error={e.improvements}>
        <Textarea name="improvements" rows={3} defaultValue={initial.improvements ?? ""} />
      </Field>
      <Field label="Your comments" error={e.reviewer_comments}>
        <Textarea name="reviewer_comments" rows={3} defaultValue={initial.reviewer_comments ?? ""} />
      </Field>
      <div className="max-w-xs">
        <Field label="Next review" error={e.next_review_date} hint="Blank: six months after the period ends">
          <Input name="next_review_date" type="date" defaultValue={initial.next_review_date ?? ""} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save notes"}
        </Button>
        {state.ok && state.message && <span className="text-sm text-emerald-700">{state.message}</span>}
      </div>
    </form>
  );
}

export function AcknowledgeForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Acknowledge" submitLabel="Acknowledge" variant="primary">
      {(e) => (
        <Field label="Your comments" error={e.comments} hint="Optional. Your reviewer and HR will see them.">
          <Textarea name="comments" rows={3} />
        </Field>
      )}
    </InlineForm>
  );
}

export function GoalForm({ action, people }: { action: Action; people: PersonOption[] }) {
  return (
    <InlineForm action={action} openLabel="Set a goal" submitLabel="Set goal" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" error={e.employee_id}>
            <PeopleSelect people={people} />
          </Field>
          <Field label="Goal" error={e.title}>
            <Input name="title" required maxLength={200} />
          </Field>
          <Field label="Kind" error={e.goal_type}>
            <Select name="goal_type" defaultValue="performance" required>
              {Object.entries(GOAL_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target date" error={e.target_date}>
            <Input name="target_date" type="date" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" error={e.description}>
              <Textarea name="description" rows={2} />
            </Field>
          </div>
        </div>
      )}
    </InlineForm>
  );
}

export function ProgressForm({ action, progress }: { action: Action; progress: number }) {
  return (
    <InlineForm action={action} openLabel="Update progress" submitLabel="Save">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label="Progress (%)" error={e.progress} hint="100 completes the goal">
            <Input name="progress" type="number" min={0} max={100} step={1} defaultValue={progress} required />
          </Field>
          <Field label="Note" error={e.note}>
            <Input name="note" placeholder="What has been done" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
