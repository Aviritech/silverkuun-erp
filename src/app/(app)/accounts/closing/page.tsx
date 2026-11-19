import { requireModule, requirePermission } from "@/lib/auth/session";
import { listPeriodCloses, monthEndPreview, nextMonthToClose } from "@/modules/accounts/closing";
import { ClosingView } from "@/modules/accounts/components/closing-view";
import { accountsModule } from "@/modules/accounts/module";
import { staffNameLookup } from "@/modules/accounts/queries";

export default async function ClosingPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const [next, preview, periods] = await Promise.all([nextMonthToClose(), monthEndPreview(), listPeriodCloses()]);
  const staffName = await staffNameLookup(periods.map((p) => p.closed_by));
  return (
    <ClosingView
      next={next}
      preview={preview}
      periods={periods}
      staffName={staffName}
      canClose={staff.permissions.has("accounts.period_close.run")}
    />
  );
}
