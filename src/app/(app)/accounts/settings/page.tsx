import { Badge, Card, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { addBankAccount, addCategorisationRule, addLedgerAccount, updatePostingRule } from "@/modules/accounts/actions";
import { BankAccountForm, CategorisationRuleForm, LedgerAccountForm, PostingRuleForm } from "@/modules/accounts/components/settings-forms";
import { ACCOUNT_TYPES, CASH_FLOW_CLASSES } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts, listLedgerAccounts, listPostingRules } from "@/modules/accounts/queries";

export default async function AccountsSettingsPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const supabase = await createClient();
  const [accounts, rules, banks, org, keywords] = await Promise.all([
    listLedgerAccounts(),
    listPostingRules(),
    listBankAccounts(),
    listOrg(),
    supabase.from("bank_categorisation_rules").select("id, pattern, transaction_type").order("pattern"),
  ]);
  if (keywords.error) throw dbFailure(keywords.error);
  const canConfigure = staff.permissions.has("accounts.config.manage");
  const canReconcile = staff.permissions.has("accounts.bank.reconcile");
  const name = new Map(accounts.map((a) => [a.code, a.name]));
  const detail = accounts.filter((a) => !a.is_group && a.is_active);
  const branchName = new Map(org.branches.map((b) => [b.id, b.name]));
  const ruleName = new Map(rules.map((r) => [r.transaction_type, r.name]));
  const label = (code: string | null) => (code ? `${code} ${name.get(code) ?? ""}` : "the bank account");

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Accounts settings"
        description={
          canConfigure
            ? "Changes here are recorded in the audit trail with who made them and when."
            : "Read-only. Only the Financial Controller can change the chart of accounts, posting rules and bank accounts."
        }
      />

      <Card title="Posting rules" actions={<span className="text-xs text-zinc-500">How each kind of receipt or payment reaches the ledger</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Transaction type</th>
                <th className="py-1 pr-3 font-medium">Debit</th>
                <th className="py-1 pr-3 font-medium">Credit</th>
                <th className="py-1 pr-3 font-medium">Member</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.transaction_type} className="border-t border-zinc-100 align-top">
                  <td className="py-2 pr-3">
                    {r.name} {!r.is_active && <Badge>Not in use</Badge>}
                    <span className="block text-xs text-zinc-500">{r.direction === "receipt" ? "Receipt" : "Payment"}</span>
                  </td>
                  <td className="py-2 pr-3">{label(r.debit_account)}</td>
                  <td className="py-2 pr-3">
                    {label(r.credit_account)}
                    {r.interest_account && <span className="block text-xs text-zinc-500">Interest: {label(r.interest_account)}</span>}
                  </td>
                  <td className="py-2 pr-3">{r.requires_member ? "Required" : "Optional"}</td>
                  <td className="py-2">{canConfigure && <PostingRuleForm action={updatePostingRule.bind(null, r.transaction_type)} rule={r} accounts={detail} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Bank and cash accounts" actions={canConfigure && <BankAccountForm action={addBankAccount} branches={org.branches} cashAccounts={detail.filter((a) => a.cash_flow_class === "cash")} />}>
        <ul className="divide-y divide-zinc-100 text-sm">
          {banks.map((b) => (
            <li key={b.id} className="flex justify-between py-2">
              <span>
                {b.name} <span className="text-xs text-zinc-500">({branchName.get(b.branch_id)})</span>
              </span>
              <span className="text-zinc-600">
                {b.kind === "bank" ? `${b.bank_name ?? ""} ${b.account_number ?? ""} · ` : "Cash · "}
                {label(b.ledger_account_code)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Statement keywords" actions={canReconcile && <CategorisationRuleForm action={addCategorisationRule} rules={rules.filter((r) => r.is_active)} />}>
        <p className="mb-2 text-sm text-zinc-600">Imported statement lines containing these words get a suggested transaction type. Suggestions are never posted without review.</p>
        <ul className="flex flex-wrap gap-2 text-sm">
          {(keywords.data ?? []).map((k) => (
            <li key={k.id} className="rounded-full bg-zinc-100 px-3 py-1">
              {k.pattern} → {ruleName.get(k.transaction_type)}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Chart of accounts" actions={canConfigure && <LedgerAccountForm action={addLedgerAccount} groups={accounts.filter((a) => a.is_group)} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Code</th>
                <th className="py-1 pr-3 font-medium">Account</th>
                <th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 pr-3 font-medium">Cash flow</th>
                <th className="py-1 font-medium">What goes here</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.code} className={`border-t border-zinc-100 ${a.is_group ? "bg-zinc-50 font-medium" : ""}`}>
                  <td className="py-1.5 pr-3 font-mono text-xs">{a.code}</td>
                  <td className={`py-1.5 pr-3 ${a.parent_code && !a.is_group ? "pl-4" : ""}`}>
                    {a.name} {!a.is_active && <Badge>Inactive</Badge>}
                  </td>
                  <td className="py-1.5 pr-3">{ACCOUNT_TYPES[a.account_type]}</td>
                  <td className="py-1.5 pr-3">{a.is_group ? "" : CASH_FLOW_CLASSES[a.cash_flow_class as keyof typeof CASH_FLOW_CLASSES]}</td>
                  <td className="py-1.5 text-zinc-600">{a.is_group ? "Heading" : a.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
