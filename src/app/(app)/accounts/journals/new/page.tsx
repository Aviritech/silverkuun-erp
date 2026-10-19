import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { createJournal } from "@/modules/accounts/actions";
import { JournalForm } from "@/modules/accounts/components/journal-form";
import { accountsModule } from "@/modules/accounts/module";
import { listLedgerAccounts, listMemberOptions } from "@/modules/accounts/queries";

export default async function NewJournalPage() {
  const staff = await requireModule(accountsModule);
  const [org, accounts, members] = await Promise.all([listOrg(), listLedgerAccounts(), listMemberOptions()]);
  const branches = org.branches.filter((b) => staff.permissions.hasForBranch("accounts.journals.prepare", b));
  if (branches.length === 0) notFound();
  return (
    <div className="max-w-6xl">
      <PageHeader title="New manual journal" description="Use for accruals, depreciation, opening balances and corrections. Debits must equal credits." />
      <Card>
        <JournalForm
          action={createJournal}
          branches={branches}
          accounts={accounts.filter((a) => !a.is_group && a.is_active)}
          members={members}
        />
      </Card>
    </div>
  );
}
