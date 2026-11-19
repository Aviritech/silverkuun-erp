/*
 * Crediting a member's account is reserved to one person, the Receipts Confirmation Accountant
 * (permission accounts.members.credit). The database enforces it (migration 20261118000001); these helpers keep the
 * buttons and queues in step with it.
 */

export const MEMBER_CREDIT_PERMISSION = "accounts.members.credit";

/** Ledger accounts that make up a member's position (the same set as app.member_ledger_accounts()). */
export const MEMBER_LEDGER_ACCOUNTS = new Set(["2110", "2120", "2130", "2140", "3100", "1210", "1220", "4100"]);

type RuleAccounts = { credit_account: string | null; interest_account: string | null } | null | undefined;

/** True when posting this receipt credits a member's account. */
export function receiptCreditsMember(txn: { direction: string; member_id?: string | null }, rule: RuleAccounts): boolean {
  if (txn.direction !== "receipt" || !txn.member_id || !rule) return false;
  return [rule.credit_account, rule.interest_account].some((a) => a !== null && MEMBER_LEDGER_ACCOUNTS.has(a));
}

/** True when any line of the entry credits a member's account (or, for reverse, any line debits one). */
export function linesCreditMember(
  lines: { account_code: string; debit: string | number; credit: string | number; member_id: string | null }[],
  side: "credit" | "debit" = "credit",
): boolean {
  return lines.some((l) => l.member_id && MEMBER_LEDGER_ACCOUNTS.has(l.account_code) && Number(l[side]) > 0);
}

/** Which permissions may confirm, return or approve a submitted transaction. */
export function decisionPermissions(direction: "receipt" | "payment", creditsMember: boolean): string[] {
  if (direction === "payment") return ["accounts.transactions.approve", "accounts.payments.approve"];
  if (creditsMember) return [MEMBER_CREDIT_PERMISSION];
  return ["accounts.transactions.approve", MEMBER_CREDIT_PERMISSION];
}
