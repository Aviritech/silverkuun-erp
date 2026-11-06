/*
 * Checks on savings pay-ins before Accounts posts them: is there a bank statement line for the money, and could the
 * pay-in be a duplicate of one already recorded? These are hints for the accountant; nothing is matched automatically.
 */

export type PayIn = { id: string; member_id: string; branch_id: string; amount: number; paid_on: string; reference: string | null; payment_method: string };
export type StatementLine = { id: string; bank_account_id: string; branch_id: string; line_date: string; amount: number; reference: string | null; description: string };
export type RecordedReceipt = { id: string; txn_no: string; member_id: string; amount: number; txn_date: string };

export type PayInCheck = {
  /** The best unmatched bank line for this pay-in, if any. */
  line: StatementLine | null;
  /** Another pay-in or a receipt already recorded for the same member, amount and day. */
  duplicateOf: { kind: "payin"; id: string } | { kind: "receipt"; id: string; txn_no: string } | null;
};

/** A bank line can be dated up to a day before the pay-in (keyed late) and up to five days after (clearing). */
export const MATCH_WINDOW = { before: 1, after: 5 } as const;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function checkPayIns(payIns: PayIn[], lines: StatementLine[], receipts: RecordedReceipt[]): Map<string, PayInCheck> {
  const out = new Map<string, PayInCheck>();
  const used = new Set<string>();

  // Pay-ins with a reference go first, so a line whose reference matches goes to the right one.
  const order = [...payIns].sort((a, b) => Number(Boolean(b.reference)) - Number(Boolean(a.reference)) || a.paid_on.localeCompare(b.paid_on));
  for (const p of order) {
    let best: { line: StatementLine; score: number } | null = null;
    if (p.payment_method !== "cash") {
      for (const l of lines) {
        if (used.has(l.id) || l.branch_id !== p.branch_id || Math.abs(l.amount - p.amount) >= 0.005) continue;
        const gap = dayDiff(l.line_date, p.paid_on);
        if (gap < -MATCH_WINDOW.before || gap > MATCH_WINDOW.after) continue;
        const ref = norm(p.reference);
        const refHit = ref.length >= 4 && (norm(l.reference).includes(ref) || norm(l.description).includes(ref));
        const score = (refHit ? 100 : 0) - Math.abs(gap);
        if (!best || score > best.score) best = { line: l, score };
      }
    }
    if (best) used.add(best.line.id);
    out.set(p.id, { line: best?.line ?? null, duplicateOf: null });
  }

  for (const p of payIns) {
    const same = (member: string, amount: number, date: string) => member === p.member_id && Math.abs(amount - p.amount) < 0.005 && date === p.paid_on;
    const receipt = receipts.find((r) => same(r.member_id, r.amount, r.txn_date));
    const twin = payIns.find((o) => o.id !== p.id && same(o.member_id, o.amount, o.paid_on));
    out.get(p.id)!.duplicateOf = receipt ? { kind: "receipt", id: receipt.id, txn_no: receipt.txn_no } : twin ? { kind: "payin", id: twin.id } : null;
  }
  return out;
}
