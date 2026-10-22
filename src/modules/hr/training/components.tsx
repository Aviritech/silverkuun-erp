"use client";

import { InlineForm } from "@/components/inline-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { RATING_LABELS } from "./constants";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const today = () => new Date().toISOString().slice(0, 10);

export function TrainingForm({ action, departments }: { action: Action; departments: { code: string; name: string }[] }) {
  return (
    <InlineForm action={action} openLabel="Schedule training" submitLabel="Schedule" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Title" error={e.title}>
              <Input name="title" required maxLength={200} />
            </Field>
          </div>
          <Field label="Trainer" error={e.trainer} hint="A person or a training firm">
            <Input name="trainer" />
          </Field>
          <Field label="Starts" error={e.starts_on}>
            <Input name="starts_on" type="date" min={today()} required />
          </Field>
          <Field label="Ends" error={e.ends_on}>
            <Input name="ends_on" type="date" min={today()} required />
          </Field>
          <Field label="Hours" error={e.hours} hint="Total training hours">
            <Input name="hours" type="number" min={0.5} step={0.5} />
          </Field>
          <Field label="Venue" error={e.venue}>
            <Input name="venue" />
          </Field>
          <Field label="Meeting link" error={e.meeting_url} hint="For online training">
            <Input name="meeting_url" type="url" placeholder="https://" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="is_virtual" className="h-4 w-4 rounded border-zinc-300" />
            Held online
          </label>
          <Field label="Places" error={e.capacity} hint="Blank: no limit">
            <Input name="capacity" type="number" min={1} step={1} />
          </Field>
          <Field label="Cost per person (₦)" error={e.cost_per_person}>
            <Input name="cost_per_person" type="number" min={0} step="0.01" />
          </Field>
          <Field label="Pass mark (%)" error={e.pass_mark} hint="Blank if it isn't scored">
            <Input name="pass_mark" type="number" min={0} max={100} step={1} />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Description" error={e.description}>
              <Textarea name="description" rows={2} />
            </Field>
          </div>
          <fieldset className="sm:col-span-3">
            <legend className="text-sm font-medium text-zinc-800">For departments</legend>
            <p className="text-xs text-zinc-500">Tick none to open it to everyone. You can still enrol anyone yourself.</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {departments.map((d) => (
                <label key={d.code} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="departments" value={d.code} className="h-4 w-4 rounded border-zinc-300" />
                  {d.name}
                </label>
              ))}
            </div>
            {e.departments && <span className="mt-1 block text-xs text-red-700">{e.departments}</span>}
          </fieldset>
        </div>
      )}
    </InlineForm>
  );
}

export function EnrolForm({ action, people }: { action: Action; people: { id: string; label: string }[] }) {
  return (
    <InlineForm action={action} openLabel="Enrol an employee" submitLabel="Enrol" variant="primary">
      {(e) => (
        <Field label="Employee" error={e.employee_id}>
          <Select name="employee_id" defaultValue="" required>
            <option value="">Choose</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </InlineForm>
  );
}

export function ResultForm({ action, passMark, hours }: { action: Action; passMark: number | null; hours: string | null }) {
  return (
    <InlineForm action={action} openLabel="Record result" submitLabel="Save result">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Result" error={e.status}>
            <Select name="status" defaultValue="completed" required>
              <option value="completed">Completed</option>
              <option value="no_show">Didn&apos;t attend</option>
            </Select>
          </Field>
          <Field label="Hours attended" error={e.hours} hint={hours ? `Blank: the full ${Number(hours)}` : undefined}>
            <Input name="hours" type="number" min={0} step={0.5} />
          </Field>
          <Field label="Score (%)" error={e.score} hint={passMark === null ? "Not scored" : `Pass mark ${passMark}%`}>
            <Input name="score" type="number" min={0} max={100} step="0.01" disabled={passMark === null} />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function FeedbackForm({ action, existing }: { action: Action; existing?: { rating: number | null; comment: string | null } }) {
  return (
    <InlineForm action={action} openLabel={existing?.rating ? "Change feedback" : "Give feedback"} submitLabel="Send feedback">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Rating" error={e.rating}>
            <Select name="rating" defaultValue={existing?.rating ? String(existing.rating) : ""} required>
              <option value="">Choose</option>
              {Object.entries(RATING_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Comment" error={e.comment}>
            <Input name="comment" defaultValue={existing?.comment ?? ""} placeholder="What worked, and what could be better" />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
