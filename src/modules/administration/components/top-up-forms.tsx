"use client";

import { useMemo, useState } from "react";
import { InlineForm } from "@/components/inline-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { INFLOW_TYPES, type InflowType } from "@/modules/accounts/top-ups";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
export type PlanOption = { id: string; member_id: string; label: string; search: string };

/** Words in "paid by" that are worth matching on a member's name. */
function nameWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);
}

/**
 * The officer finds the member's plan and logs the inflow, as a regular contribution or a top up. Plans whose member's name shares a word with "paid by"
 * are listed first; the search box narrows the list.
 */
export function LogTopUpForm({
  action,
  plans,
  paidBy,
  matchedMemberId,
  matchedPlanId,
  inflowType,
}: {
  action: Action;
  plans: PlanOption[];
  paidBy: string;
  /** The member and plan Accounts picked, if it did: listed first and pre-selected. */
  matchedMemberId?: string | null;
  matchedPlanId?: string | null;
  /** What Accounts said the money is for; the officer can correct it. */
  inflowType: InflowType;
}) {
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => {
    const words = nameWords(paidBy);
    return plans
      .map((p) => ({
        ...p,
        likely: matchedMemberId ? p.member_id === matchedMemberId : words.some((w) => p.search.includes(w)),
      }))
      .sort((a, b) => Number(b.likely) - Number(a.likely) || a.label.localeCompare(b.label));
  }, [plans, paidBy, matchedMemberId]);
  const q = query.trim().toLowerCase();
  const shown = (q ? ranked.filter((p) => p.search.includes(q)) : ranked).slice(0, 200);
  const likely = ranked.filter((p) => p.likely);
  const preselect =
    matchedPlanId && shown.some((p) => p.id === matchedPlanId) ? matchedPlanId : likely.length === 1 && shown.some((p) => p.id === likely[0].id) ? likely[0].id : "";

  return (
    <InlineForm action={action} openLabel="Log for a member" submitLabel="Log it" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Find the member">
            <Input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Name or membership number" />
          </Field>
          <Field label="Savings plan" error={e.member_plan_id}>
            <Select name="member_plan_id" required defaultValue={preselect} key={q}>
              <option value="">{shown.length ? "Choose the member's plan" : "No active plan matches"}</option>
              {shown.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.likely ? "★ " : ""}
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What is it for?" error={e.inflow_type}>
            <Select name="inflow_type" required defaultValue={inflowType}>
              {Object.entries(INFLOW_TYPES).map(([v, t]) => (
                <option key={v} value={v}>
                  {t.label} ({t.hint.toLowerCase()})
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Field label="Note (optional)" error={e.note}>
              <Textarea name="note" rows={2} placeholder="e.g. Member confirmed by phone" />
            </Field>
          </div>
          <p className="text-xs text-zinc-500 sm:col-span-2">
            The amount, date and reference are the ones Accounts recorded. Change what it is for only if the member&apos;s plan shows Accounts got it wrong. After you log it, the Branch Manager verifies it and Accounts posts it.
          </p>
        </div>
      )}
    </InlineForm>
  );
}
