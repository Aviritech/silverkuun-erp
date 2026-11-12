"use client";

import { useMemo, useState } from "react";
import { InlineForm } from "@/components/inline-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
export type PlanOption = { id: string; label: string; search: string };

/** Words in "paid by" that are worth matching on a member's name. */
function nameWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);
}

/**
 * The officer finds the member's plan and logs the top up. Plans whose member's name shares a word with "paid by"
 * are listed first; the search box narrows the list.
 */
export function LogTopUpForm({ action, plans, paidBy }: { action: Action; plans: PlanOption[]; paidBy: string }) {
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => {
    const words = nameWords(paidBy);
    return plans
      .map((p) => ({ ...p, likely: words.some((w) => p.search.includes(w)) }))
      .sort((a, b) => Number(b.likely) - Number(a.likely) || a.label.localeCompare(b.label));
  }, [plans, paidBy]);
  const q = query.trim().toLowerCase();
  const shown = (q ? ranked.filter((p) => p.search.includes(q)) : ranked).slice(0, 200);
  const likely = ranked.filter((p) => p.likely);

  return (
    <InlineForm action={action} openLabel="Log for a member" submitLabel="Log top up" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Find the member">
            <Input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Name or membership number" />
          </Field>
          <Field label="Savings plan" error={e.member_plan_id}>
            <Select name="member_plan_id" required defaultValue={likely.length === 1 ? likely[0].id : ""} key={q}>
              <option value="">{shown.length ? "Choose the member's plan" : "No active plan matches"}</option>
              {shown.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.likely ? "★ " : ""}
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note (optional)" error={e.note}>
              <Textarea name="note" rows={2} placeholder="e.g. Member confirmed by phone" />
            </Field>
          </div>
          <p className="text-xs text-zinc-500 sm:col-span-2">
            The amount, date and reference are the ones Accounts recorded. After you log it, the Branch Manager verifies it and Accounts posts it.
          </p>
        </div>
      )}
    </InlineForm>
  );
}
