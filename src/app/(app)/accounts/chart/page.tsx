import Link from "next/link";
import { ControlNote } from "@/components/dashboard";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatMoney } from "@/lib/format";
import { today } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { addLedgerAccount } from "@/modules/accounts/actions";
import { LedgerAccountForm } from "@/modules/accounts/components/settings-forms";
import { ACCOUNT_TYPES, CASH_FLOW_CLASSES } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";
import { listLedgerAccounts, type LedgerAccount } from "@/modules/accounts/queries";

/** Assets and expenses carry debit balances; the rest carry credit balances. Shown the natural way round. */
const DEBIT_NATURE = new Set<LedgerAccount["account_type"]>(["asset", "expense"]);

export default async function ChartOfAccountsPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const supabase = await createClient();
  const asAt = today();
  const [accounts, balances] = await Promise.all([
    listLedgerAccounts(),
    supabase.rpc("account_balances", { p_from: asAt, p_to: asAt, p_branch_id: null, p_region_id: null }),
  ]);
  if (balances.error) throw dbFailure(balances.error);
  const closing = new Map((balances.data as { code: string; closing: string }[]).map((b) => [b.code, Number(b.closing)]));

  // A heading's balance is the sum of the accounts under it, at any depth.
  const children = new Map<string, LedgerAccount[]>();
  for (const a of accounts) if (a.parent_code) children.set(a.parent_code, [...(children.get(a.parent_code) ?? []), a]);
  const total = (a: LedgerAccount): number => (a.is_group ? (children.get(a.code) ?? []).reduce((s, c) => s + total(c), 0) : (closing.get(a.code) ?? 0));
  const depth = (a: LedgerAccount): number => {
    let d = 0;
    for (let p = a.parent_code; p; p = accounts.find((x) => x.code === p)?.parent_code ?? null) d++;
    return d;
  };
  const canConfigure = staff.permissions.has("accounts.config.manage");
  const types = Object.keys(ACCOUNT_TYPES) as LedgerAccount["account_type"][];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="General ledger"
        title="Chart of accounts"
        description="A compact list of ledger accounts. Members, branches, savings products and suppliers are tracked as linked records and dimensions, not as separate accounts."
        actions={canConfigure && <LedgerAccountForm action={addLedgerAccount} groups={accounts.filter((a) => a.is_group)} />}
      />
      {types.map((type) => {
        const list = accounts.filter((a) => a.account_type === type);
        if (!list.length) return null;
        const sign = DEBIT_NATURE.has(type) ? 1 : -1;
        return (
          <Card key={type} title={ACCOUNT_TYPES[type]}>
            <div className="-mx-5 -my-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                  <tr>
                    <th className="w-20 px-5 py-2.5 font-medium">Code</th>
                    <th className="px-5 py-2.5 font-medium">Account</th>
                    <th className="px-5 py-2.5 font-medium">Cash flow</th>
                    <th className="px-5 py-2.5 font-medium">What goes here</th>
                    <th className="px-5 py-2.5 text-right font-medium">Balance today</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.code} className={`border-b border-zinc-100 last:border-0 ${a.is_group ? "bg-neutral-50 font-medium" : "hover:bg-zinc-50"}`}>
                      <td className="px-5 py-2 font-mono text-xs">{a.code}</td>
                      <td className="px-5 py-2" style={{ paddingLeft: `${1.25 + Math.max(0, depth(a) - 1) * 1}rem` }}>
                        {a.is_group ? (
                          a.name
                        ) : (
                          <Link href={`/accounts/reports/general-ledger?account=${a.code}`} className="hover:underline">
                            {a.name}
                          </Link>
                        )}{" "}
                        {!a.is_active && <Badge>Inactive</Badge>}
                      </td>
                      <td className="px-5 py-2 text-zinc-600">{a.is_group ? "" : CASH_FLOW_CLASSES[a.cash_flow_class as keyof typeof CASH_FLOW_CLASSES]}</td>
                      <td className="px-5 py-2 text-zinc-600">{a.is_group ? "Heading" : a.description}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{formatMoney(sign * total(a))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
      <ControlNote>
        Balances are posted journals up to today for the branches you work in. Adding an account needs the Financial Controller&apos;s settings
        permission; how each receipt or payment reaches these accounts is set by the posting rules under Settings, and a change needs a second
        person to approve it.
      </ControlNote>
    </div>
  );
}
