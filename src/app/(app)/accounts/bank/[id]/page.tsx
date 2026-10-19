import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import {
  autoMatch,
  completeReconciliation,
  excludeLine,
  importStatement,
  matchLines,
  prepareReconciliation,
  restoreLine,
  unmatch,
} from "@/modules/accounts/actions";
import { MatchPanel } from "@/modules/accounts/components/match-panel";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { ReconciliationForm } from "@/modules/accounts/components/reconciliation-form";
import { StatementImportForm } from "@/modules/accounts/components/statement-import-form";
import { STATEMENT_LINE_STATUSES } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";
import { staffNameLookup, type BankAccount } from "@/modules/accounts/queries";

type StatementLine = {
  id: string;
  line_date: string;
  description: string;
  reference: string | null;
  amount: string;
  running_balance: string | null;
  status: keyof typeof STATEMENT_LINE_STATUSES;
  match_id: string | null;
  suggested_type: string | null;
  suggestion_reason: string | null;
  exclusion_reason: string | null;
  row_no: number;
};

export default async function BankAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const [{ id }, { show }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: bankRow, error } = await supabase.from("bank_accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  const bank = bankRow as BankAccount | null;
  if (!bank || bank.kind !== "bank") notFound();

  const [lines, ledger, imports, recs, balance, rules, org] = await Promise.all([
    supabase.from("bank_statement_lines").select("*").eq("bank_account_id", id).order("line_date", { ascending: false }).order("row_no", { ascending: false }).limit(500),
    supabase.from("unmatched_bank_ledger_lines").select("*").eq("bank_account_id", id).order("entry_date"),
    supabase.from("bank_statement_imports").select("*").eq("bank_account_id", id).order("imported_at", { ascending: false }).limit(10),
    supabase.from("bank_reconciliations").select("*").eq("bank_account_id", id).order("period_end", { ascending: false }).limit(12),
    supabase.from("bank_account_balances").select("*").eq("bank_account_id", id).maybeSingle(),
    supabase.from("posting_rules").select("transaction_type, name"),
    listOrg(),
  ]);
  for (const r of [lines, ledger, imports, recs, balance, rules]) if (r.error) throw dbFailure(r.error);
  const statement = lines.data as StatementLine[];
  const ruleName = new Map((rules.data ?? []).map((r) => [r.transaction_type, r.name]));
  const branch = org.branches.find((b) => b.id === bank.branch_id)!;
  const canReconcile = staff.permissions.hasForBranch("accounts.bank.reconcile", branch);
  const canReview = staff.permissions.hasForBranch("accounts.transactions.approve", branch);
  const canRecordReceipt = staff.permissions.hasForBranch("accounts.receipts.record", branch);
  const canRequestPayment = staff.permissions.hasForBranch("accounts.payments.request", branch);
  type Rec = {
    id: string; period_end: string; statement_balance: string; ledger_balance: string; unmatched_statement_total: string; unmatched_ledger_total: string;
    difference: string; notes: string | null; status: "draft" | "completed"; prepared_by: string; prepared_at: string; completed_by: string | null; completed_at: string | null;
  };
  const reconciliations = recs.data as Rec[];
  const staffName = await staffNameLookup([...reconciliations.flatMap((r) => [r.prepared_by, r.completed_by]), ...(imports.data ?? []).map((i) => i.imported_by)]);

  const unmatched = statement.filter((l) => l.status === "unmatched");
  const visible = show === "all" ? statement : statement.filter((l) => l.status !== "matched");
  const latest = statement[0];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={bank.name}
        description={`${bank.bank_name ?? ""} ${bank.account_number ?? ""} · ${branch.name} · ledger ${bank.ledger_account_code}`}
        actions={
          <Link href="/accounts/bank" className="text-sm underline">
            All bank accounts
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Ledger balance", formatMoney(balance.data?.ledger_balance)],
          ["Latest statement balance", latest?.running_balance ? formatMoney(latest.running_balance) : "—"],
          ["Unmatched statement lines", String(unmatched.length)],
          ["Unmatched ledger lines", String(ledger.data?.length ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-600">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {canReconcile && (
        <Card title="Import a statement">
          <StatementImportForm action={importStatement.bind(null, bank.id)} mapping={bank.import_mapping} />
          {(imports.data ?? []).length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-zinc-600">
              {(imports.data ?? []).map((i) => (
                <li key={i.id}>
                  {i.file_name}: {i.line_count} lines{i.duplicate_count ? `, ${i.duplicate_count} duplicates skipped` : ""} ({formatDate(i.statement_from)} to{" "}
                  {formatDate(i.statement_to)}), imported by {staffName(i.imported_by)} on {formatDateTime(i.imported_at)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {canReconcile && (
        <Card title="Match" actions={<ActionButton action={autoMatch.bind(null, bank.id)} label="Auto-match safe pairs" variant="secondary" />}>
          <MatchPanel
            action={matchLines.bind(null, bank.id)}
            statement={unmatched.map((l) => ({ id: l.id, line_date: l.line_date, description: l.description, reference: l.reference, amount: Number(l.amount) }))}
            ledger={(ledger.data ?? []).map((l) => ({ id: l.id, entry_date: l.entry_date, entry_no: l.entry_no, description: l.description, amount: Number(l.amount) }))}
          />
        </Card>
      )}

      <Card
        title="Statement lines"
        actions={
          <Link href={show === "all" ? `/accounts/bank/${bank.id}` : `/accounts/bank/${bank.id}?show=all`} className="text-sm underline">
            {show === "all" ? "Hide matched lines" : "Show matched lines too"}
          </Link>
        }
      >
        {visible.length === 0 ? (
          <EmptyState>{statement.length ? "Every line is matched." : "No statement imported yet."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Date</th>
                  <th className="py-1 pr-3 font-medium">Description</th>
                  <th className="py-1 pr-3 text-right font-medium">Amount</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => {
                  const amount = Number(l.amount);
                  const direction = amount > 0 ? "receipt" : "payment";
                  const canCreate = direction === "receipt" ? canRecordReceipt : canRequestPayment;
                  return (
                    <tr key={l.id} className="border-t border-zinc-100 align-top">
                      <td className="whitespace-nowrap py-2 pr-3">{formatDate(l.line_date)}</td>
                      <td className="py-2 pr-3">
                        {l.description}
                        {l.reference && <span className="block font-mono text-xs text-zinc-500">{l.reference}</span>}
                        {l.status === "unmatched" && l.suggested_type && (
                          <span className="block text-xs text-sky-800">
                            Suggested: {ruleName.get(l.suggested_type)} ({l.suggestion_reason})
                          </span>
                        )}
                        {l.exclusion_reason && <span className="block text-xs text-zinc-500">Set aside: {l.exclusion_reason}</span>}
                      </td>
                      <td className={`whitespace-nowrap py-2 pr-3 text-right tabular-nums ${amount < 0 ? "text-red-800" : ""}`}>{formatMoney(amount)}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={STATEMENT_LINE_STATUSES[l.status].tone}>{STATEMENT_LINE_STATUSES[l.status].label}</Badge>
                      </td>
                      <td className="py-2">
                        {canReconcile && (
                          <div className="flex flex-wrap gap-2">
                            {l.status === "unmatched" && canCreate && (
                              <ButtonLink href={`/accounts/transactions/new?direction=${direction}&line=${l.id}`} variant="secondary">
                                Record {direction}
                              </ButtonLink>
                            )}
                            {l.status === "unmatched" && (
                              <ReasonForm
                                action={excludeLine.bind(null, bank.id, l.id)}
                                openLabel="Set aside"
                                submitLabel="Set aside"
                                question="Why? (for example: duplicate line, reversed by the bank the same day)"
                                variant="secondary"
                              />
                            )}
                            {l.status === "excluded" && <ActionButton action={restoreLine.bind(null, bank.id, l.id)} label="Restore" variant="secondary" />}
                            {l.status === "matched" && l.match_id && (
                              <ActionButton action={unmatch.bind(null, bank.id, l.match_id)} label="Unmatch" variant="secondary" confirm="Undo this match?" />
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Reconciliations"
        actions={
          canReconcile && (
            <ReconciliationForm
              action={prepareReconciliation.bind(null, bank.id)}
              defaultBalance={latest?.running_balance ?? ""}
              defaultDate={latest?.line_date ?? new Date().toISOString().slice(0, 10)}
            />
          )
        }
      >
        {reconciliations.length === 0 ? (
          <EmptyState>No reconciliations yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Statement date</th>
                  <th className="py-1 pr-3 text-right font-medium">Statement</th>
                  <th className="py-1 pr-3 text-right font-medium">Ledger</th>
                  <th className="py-1 pr-3 text-right font-medium">Unmatched on statement</th>
                  <th className="py-1 pr-3 text-right font-medium">Unmatched in ledger</th>
                  <th className="py-1 pr-3 text-right font-medium">Difference</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {reconciliations.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100 align-top">
                    <td className="py-2 pr-3">{formatDate(r.period_end)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(r.statement_balance)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(r.ledger_balance)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(r.unmatched_statement_total)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(r.unmatched_ledger_total)}</td>
                    <td className={`py-2 pr-3 text-right font-medium tabular-nums ${Number(r.difference) ? "text-red-800" : "text-emerald-700"}`}>
                      {formatMoney(r.difference)}
                    </td>
                    <td className="py-2">
                      {r.status === "completed" ? (
                        <span>
                          <Badge tone="green">Completed</Badge>
                          <span className="block text-xs text-zinc-500">
                            Prepared by {staffName(r.prepared_by)}, reviewed by {staffName(r.completed_by)} on {formatDate(r.completed_at)}
                          </span>
                        </span>
                      ) : (
                        <span className="flex flex-col gap-1">
                          <Badge tone="amber">Draft</Badge>
                          <span className="text-xs text-zinc-500">Prepared by {staffName(r.prepared_by)}</span>
                          {canReview && r.prepared_by !== staff.id && (
                            <ActionButton action={completeReconciliation.bind(null, bank.id, r.id)} label="Review and complete" variant="secondary" />
                          )}
                        </span>
                      )}
                      {r.notes && <span className="mt-1 block text-xs text-zinc-600">Reconciling items: {r.notes}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          Difference = (statement balance − unmatched statement lines) − (ledger balance − unmatched ledger lines). A reconciliation completes when
          the difference is zero, or when the reconciling items are written down and someone other than the preparer reviews it.
        </p>
      </Card>
    </div>
  );
}
