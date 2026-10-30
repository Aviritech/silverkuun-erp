"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";

export type AccrualMember = { member_id: string; name: string; membership_no: string | null; balance: number };

/**
 * One ROI amount per member, credited to ROI payable against a single interest expense debit. The rate box is only a
 * convenience for filling amounts; the Society's ROI rule per product is still to be confirmed.
 */
export function RoiAccrualForm({
  action,
  branchId,
  members,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  branchId: string;
  members: AccrualMember[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [rate, setRate] = useState("");
  const e = state.fieldErrors ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const total = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0);

  function applyRate() {
    const r = Number(rate) / 100;
    if (!Number.isFinite(r) || r <= 0) return;
    setAmounts(Object.fromEntries(members.map((m) => [m.member_id, (Math.round(m.balance * r * 100) / 100).toFixed(2)])));
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error ?? e.members} />
      <input type="hidden" name="branch_id" value={branchId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Accrual date" error={e.entry_date}>
          <Input name="entry_date" type="date" max={today} defaultValue={today} required />
        </Field>
        <Field label="Description" error={e.description}>
          <Input name="description" required defaultValue={`ROI accrual for ${today.slice(0, 7)}`} />
        </Field>
        <Field label="Fill amounts at a rate (% of verified balance)" hint="Optional. Check each amount before saving.">
          <div className="flex gap-2">
            <Input type="number" min="0" step="0.01" value={rate} onChange={(ev) => setRate(ev.target.value)} />
            <Button type="button" variant="secondary" onClick={applyRate}>
              Fill
            </Button>
          </div>
        </Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Member</th>
              <th className="py-1 pr-3 text-right font-medium">Verified contributions</th>
              <th className="py-1 font-medium">ROI to accrue (₦)</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.member_id} className="border-t border-zinc-100">
                <td className="py-1.5 pr-3">
                  {m.name} {m.membership_no && <span className="font-mono text-xs text-zinc-500">{m.membership_no}</span>}
                  <input type="hidden" name="member_id" value={m.member_id} />
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(m.balance)}</td>
                <td className="py-1.5">
                  <Input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amounts[m.member_id] ?? ""}
                    onChange={(ev) => setAmounts((a) => ({ ...a, [m.member_id]: ev.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm">
        Debit 5100 Interest expense <strong>{formatMoney(total)}</strong>; credit 2140 ROI payable to each member above.
      </p>
      <Button type="submit" disabled={pending || total <= 0}>
        {pending ? "Saving…" : "Save as draft journal"}
      </Button>
    </form>
  );
}
