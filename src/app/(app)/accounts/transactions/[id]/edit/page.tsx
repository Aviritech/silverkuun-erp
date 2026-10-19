import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { saveTransaction } from "@/modules/accounts/actions";
import { TransactionForm } from "@/modules/accounts/components/transaction-form";
import { accountsModule } from "@/modules/accounts/module";
import {
  listBankAccounts,
  listLoanOptions,
  listMemberOptions,
  listPostingRules,
  loadDimensionChoices,
  type FinanceTransaction,
} from "@/modules/accounts/queries";

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(accountsModule);
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("finance_transactions").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  const txn = data as FinanceTransaction | null;
  if (!txn || txn.created_by !== staff.id || !["draft", "returned"].includes(txn.status)) notFound();

  const [rules, banks, members, org, dimensions, loans] = await Promise.all([
    listPostingRules(),
    listBankAccounts(),
    listMemberOptions(),
    listOrg(),
    loadDimensionChoices(),
    listLoanOptions(),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${txn.txn_no}`} description="Correct the details, then submit it again from the transaction page." />
      <Card>
        <TransactionForm
          action={saveTransaction.bind(null, txn.id)}
          direction={txn.direction}
          rules={rules.filter((r) => r.direction === txn.direction && (r.is_active || r.transaction_type === txn.transaction_type))}
          banks={banks.filter((b) => b.is_active && (txn.contribution_id || txn.statement_line_id ? b.id === txn.bank_account_id : true))}
          members={members}
          loans={loans}
          dimensions={dimensions}
          branchName={new Map(org.branches.map((b) => [b.id, b.name]))}
          defaults={{ ...txn, interest_amount: Number(txn.interest_amount) ? txn.interest_amount : "" }}
          withEvidence={false}
          submitLabel="Save changes"
        />
      </Card>
    </div>
  );
}
