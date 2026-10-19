import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { listDimensions, listOrg } from "@/lib/org";
import { saveBill } from "@/modules/accounts/actions";
import { BillForm } from "@/modules/accounts/components/bill-forms";
import { accountsModule } from "@/modules/accounts/module";
import { listLedgerAccounts, listSuppliers } from "@/modules/accounts/queries";

export default async function NewBillPage() {
  const staff = await requireModule(accountsModule);
  if (!staff.permissions.has("accounts.payments.request")) notFound();
  const [suppliers, org, dimensions, accounts] = await Promise.all([listSuppliers(), listOrg(), listDimensions(), listLedgerAccounts()]);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Record a supplier bill"
        description="Enter the supplier's invoice and attach it. Someone else approves it, which posts it to supplier payables."
      />
      <Card>
        <BillForm
          action={saveBill.bind(null, null)}
          suppliers={suppliers}
          branches={org.branches.filter((b) => staff.permissions.hasForBranch("accounts.payments.request", b))}
          departments={dimensions.departments}
          accounts={accounts.filter((a) => !a.is_group && a.is_active && (a.account_type === "expense" || a.account_type === "asset") && a.cash_flow_class !== "cash")}
          withInvoice
          submitLabel="Save draft"
        />
      </Card>
    </div>
  );
}
