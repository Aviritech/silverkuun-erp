import { requireModule, requirePermission } from "@/lib/auth/session";
import { dayEndPreview, getBusinessDateStatus, listClosedDays, listPeriodCloses } from "@/modules/accounts/closing";
import { ClosingView } from "@/modules/accounts/components/closing-view";
import { accountsModule } from "@/modules/accounts/module";
import { staffNameLookup } from "@/modules/accounts/queries";

export default async function ClosingPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const [status, preview, days, periods] = await Promise.all([getBusinessDateStatus(), dayEndPreview(), listClosedDays(), listPeriodCloses()]);
  const staffName = await staffNameLookup([...days.map((d) => d.closed_by), ...periods.map((p) => p.closed_by)]);
  return (
    <ClosingView
      status={status}
      preview={preview}
      days={days}
      periods={periods}
      staffName={staffName}
      permissions={{ close: staff.permissions.has("accounts.day_end.run"), configure: staff.permissions.has("accounts.config.manage") }}
      today={new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date())}
    />
  );
}
