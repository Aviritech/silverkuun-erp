import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { saveTransaction } from "@/modules/accounts/actions";
import { TransactionForm, type TransactionDefaults } from "@/modules/accounts/components/transaction-form";
import { accountsModule } from "@/modules/accounts/module";
import { listBankAccounts, listMemberOptions, listPostingRules } from "@/modules/accounts/queries";

export default async function NewTransactionPage({ searchParams }: { searchParams: Promise<{ direction?: string; line?: string }> }) {
  const staff = await requireModule(accountsModule);
  const { direction: d, line } = await searchParams;
  const direction = d === "payment" ? "payment" : "receipt";
  const permission = direction === "receipt" ? "accounts.receipts.record" : "accounts.payments.request";
  if (!staff.permissions.has(permission)) notFound();

  const [rules, allBanks, members, org] = await Promise.all([listPostingRules(), listBankAccounts(), listMemberOptions(), listOrg()]);
  const banks = allBanks.filter((b) => b.is_active && staff.permissions.hasForBranch(permission, { id: b.branch_id, region_id: org.branches.find((x) => x.id === b.branch_id)!.region_id }));

  // Opened from an unmatched bank statement line: prefill from the line.
  let defaults: TransactionDefaults = {};
  if (line) {
    const supabase = await createClient();
    const { data: l } = await supabase
      .from("bank_statement_lines")
      .select("id, bank_account_id, line_date, description, reference, amount, suggested_type, status")
      .eq("id", line)
      .maybeSingle();
    if (l && l.status === "unmatched") {
      defaults = {
        statement_line_id: l.id,
        bank_account_id: l.bank_account_id,
        txn_date: l.line_date,
        amount: String(Math.abs(Number(l.amount))),
        reference: l.reference,
        description: l.description,
        transaction_type: l.suggested_type ?? undefined,
      };
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={direction === "receipt" ? "Record a receipt" : "Request a payment"}
        description={
          direction === "receipt"
            ? "Capture the money received with its evidence. Once submitted, someone else confirms it and it posts to the ledger."
            : "Raise the request with its supporting document. Someone else approves it; then proof of payment is attached and it posts."
        }
      />
      {defaults.statement_line_id && (
        <p className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
          From a bank statement line. When this posts, it will be matched to that line automatically.
        </p>
      )}
      <Card>
        <TransactionForm
          action={saveTransaction.bind(null, null)}
          direction={direction}
          rules={rules.filter((r) => r.direction === direction && r.is_active)}
          banks={banks}
          members={members}
          branchName={new Map(org.branches.map((b) => [b.id, b.name]))}
          defaults={defaults}
          withEvidence
          submitLabel="Save draft"
        />
      </Card>
    </div>
  );
}
