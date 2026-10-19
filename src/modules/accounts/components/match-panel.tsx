"use client";

import { useActionState, useState } from "react";
import { Button, FormError, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatDate, formatMoney } from "@/lib/format";

export type OpenStatementLine = { id: string; line_date: string; description: string; reference: string | null; amount: number };
export type OpenLedgerLine = { id: string; entry_date: string; entry_no: string; description: string; amount: number };

/** Tick statement lines and ledger lines whose totals agree, then match them. Supports one-to-one, grouped and split matches. */
export function MatchPanel({
  action,
  statement,
  ledger,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  statement: OpenStatementLine[];
  ledger: OpenLedgerLine[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const statementTotal = statement.filter((l) => picked.has(l.id)).reduce((s, l) => s + l.amount, 0);
  const ledgerTotal = ledger.filter((l) => picked.has(l.id)).reduce((s, l) => s + l.amount, 0);
  const agrees = Math.round(statementTotal * 100) === Math.round(ledgerTotal * 100) && statementTotal !== 0;

  const list = (name: "statement" | "ledger", rows: (OpenStatementLine | OpenLedgerLine)[], empty: string) => (
    <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 bg-white text-sm">
      {rows.length === 0 && <li className="p-3 text-zinc-500">{empty}</li>}
      {rows.map((r) => (
        <li key={r.id}>
          <label className="flex cursor-pointer items-start gap-2 p-2 hover:bg-zinc-50">
            <input type="checkbox" name={name} value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="mt-1" />
            <span className="flex-1">
              <span className="block">{"entry_no" in r ? `${r.entry_no} · ${r.description}` : r.description}</span>
              <span className="text-xs text-zinc-500">
                {formatDate("entry_date" in r ? r.entry_date : r.line_date)}
                {"reference" in r && r.reference ? ` · ${r.reference}` : ""}
              </span>
            </span>
            <span className={`tabular-nums ${r.amount < 0 ? "text-red-800" : ""}`}>{formatMoney(r.amount)}</span>
          </label>
        </li>
      ))}
    </ul>
  );

  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.error} />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-sm font-medium">On the statement, not in the books</p>
          {list("statement", statement, "Every statement line is matched or set aside.")}
          <p className="mt-1 text-xs text-zinc-600">Ticked: {formatMoney(statementTotal)}</p>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">In the books, not on the statement</p>
          {list("ledger", ledger, "Every ledger line on this account is matched.")}
          <p className="mt-1 text-xs text-zinc-600">Ticked: {formatMoney(ledgerTotal)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Input name="note" placeholder="Note (optional)" aria-label="Note" />
        </div>
        <Button type="submit" disabled={pending || !agrees}>
          {pending ? "Matching…" : "Match ticked lines"}
        </Button>
        <span className={`text-sm ${agrees ? "text-emerald-700" : "text-zinc-500"}`}>
          {picked.size === 0 ? "Tick lines on both sides whose totals agree." : agrees ? "Totals agree." : `Difference ${formatMoney(statementTotal - ledgerTotal)}`}
        </span>
      </div>
    </form>
  );
}
