"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";
import type { LedgerAccount, MemberOption } from "../queries";

type Line = { key: number; debit: string; credit: string };

/** A manual journal with as many lines as needed; shows whether debits equal credits as you type. */
export function JournalForm({
  action,
  branches,
  accounts,
  members,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  branches: { id: string; name: string }[];
  accounts: LedgerAccount[];
  members: MemberOption[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState<Line[]>([
    { key: 1, debit: "", credit: "" },
    { key: 2, debit: "", credit: "" },
  ]);
  const e = state.fieldErrors ?? {};
  const debits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.round(debits * 100) === Math.round(credits * 100) && debits > 0;
  const update = (key: number, field: "debit" | "credit", value: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Branch" error={e.branch_id}>
          <Select name="branch_id" required defaultValue={branches.length === 1 ? branches[0].id : ""}>
            <option value="">Choose</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={e.entry_date}>
          <Input name="entry_date" type="date" max={today} defaultValue={today} required />
        </Field>
        <Field label="Description" error={e.description}>
          <Input name="description" required placeholder="e.g. Monthly depreciation" />
        </Field>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-2 font-medium">Account</th>
              <th className="w-32 py-1 pr-2 font-medium">Debit</th>
              <th className="w-32 py-1 pr-2 font-medium">Credit</th>
              <th className="py-1 pr-2 font-medium">Member (optional)</th>
              <th className="py-1 pr-2 font-medium">Line note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td className="pr-2">
                  <Select name="line_account" required defaultValue="" aria-label="Account">
                    <option value="">Choose</option>
                    {accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="pr-2">
                  <Input name="line_debit" type="number" min="0" step="0.01" value={l.debit} onChange={(ev) => update(l.key, "debit", ev.target.value)} aria-label="Debit" />
                </td>
                <td className="pr-2">
                  <Input name="line_credit" type="number" min="0" step="0.01" value={l.credit} onChange={(ev) => update(l.key, "credit", ev.target.value)} aria-label="Credit" />
                </td>
                <td className="pr-2">
                  <Select name="line_member" defaultValue="" aria-label="Member">
                    <option value="">None</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="pr-2">
                  <Input name="line_description" aria-label="Line note" />
                </td>
                <td>
                  {lines.length > 2 && (
                    <button type="button" className="text-xs text-red-700 underline" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-2">
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, debit: "", credit: "" }])}
                >
                  Add line
                </button>
              </td>
              <td className="py-2 tabular-nums">{formatMoney(debits)}</td>
              <td className="py-2 tabular-nums">{formatMoney(credits)}</td>
              <td colSpan={3} className={`py-2 text-sm ${balanced ? "text-emerald-700" : "text-amber-700"}`}>
                {balanced ? "Balanced" : `Difference ${formatMoney(Math.abs(debits - credits))}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {e.lines && <p className="text-sm text-red-700">{e.lines}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save draft"}
      </Button>
      <p className="text-xs text-zinc-500">A draft journal is posted by someone else with permission to post journals.</p>
    </form>
  );
}
