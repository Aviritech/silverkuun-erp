import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { listDimensions, listOrg } from "@/lib/org";
import { saveBill } from "@/modules/accounts/actions";
import { BillForm } from "@/modules/accounts/components/bill-forms";
import { accountsModule } from "@/modules/accounts/module";
import { getBillBundle, listLedgerAccounts, listSuppliers } from "@/modules/accounts/queries";

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(accountsModule);
  const { id } = await params;
  const bundle = await getBillBundle(id);
  if (!bundle || bundle.bill.created_by !== staff.id || !["draft", "returned"].includes(bundle.bill.status)) notFound();
  const [suppliers, org, dimensions, accounts] = await Promise.all([listSuppliers(), listOrg(), listDimensions(), listLedgerAccounts()]);
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${bundle.bill.bill_no}`} description="Correct the details, then submit it again from the bill page." />
      <Card>
        <BillForm
          action={saveBill.bind(null, id)}
          suppliers={suppliers}
          branches={org.branches}
          departments={dimensions.departments}
          accounts={accounts.filter((a) => !a.is_group && a.is_active && (a.account_type === "expense" || a.account_type === "asset") && a.cash_flow_class !== "cash")}
          defaults={bundle.bill}
          withInvoice={false}
          submitLabel="Save changes"
        />
      </Card>
    </div>
  );
}
