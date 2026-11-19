import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { getBusinessDay } from "@/modules/accounts/closing";
import { CloseReportView } from "@/modules/accounts/components/close-report";
import { accountsModule } from "@/modules/accounts/module";
import { staffNameLookup } from "@/modules/accounts/queries";

export default async function DayEndReportPage({ params }: { params: Promise<{ date: string }> }) {
  await requireModule(accountsModule);
  await requirePermission("accounts.read");
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const day = await getBusinessDay(date);
  if (!day || day.status !== "closed" || !day.report) notFound();
  const staffName = await staffNameLookup([day.closed_by]);
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        eyebrow={<Link href="/accounts/closing">End of day</Link>}
        title={`Day-end report: ${formatDate(day.business_date)}`}
        description={`Closed ${formatDateTime(day.closed_at)} by ${day.close_mode === "automatic" ? "the system" : staffName(day.closed_by)}.${day.note ? ` Note: ${day.note}` : ""}`}
        actions={<PrintButton />}
      />
      <CloseReportView report={day.report} />
    </div>
  );
}
