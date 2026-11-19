import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { getPeriodClose, periodName } from "@/modules/accounts/closing";
import { CloseReportView } from "@/modules/accounts/components/close-report";
import { accountsModule } from "@/modules/accounts/module";
import { staffNameLookup } from "@/modules/accounts/queries";

export default async function PeriodCloseReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(accountsModule);
  await requirePermission("accounts.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const close = await getPeriodClose(id);
  if (!close) notFound();
  const staffName = await staffNameLookup([close.closed_by]);
  const title = close.period_kind === "year" ? "End of Year" : "End of Month";
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        eyebrow={<Link href="/accounts/closing">Month and year end</Link>}
        title={`${title}: ${periodName(close.period_kind, close.period_end)}`}
        description={
          <>
            {formatDate(close.period_start)} to {formatDate(close.period_end)}, closed {formatDateTime(close.closed_at)} by{" "}
            {staffName(close.closed_by)}.{close.note ? ` Note: ${close.note}` : ""}
            {close.period_kind === "year" && (
              <>
                {" "}Income and expenses were closed to 3200 Accumulated surplus in {close.closing_entry_ids.length} journal{" "}
                {close.closing_entry_ids.length === 1 ? "entry" : "entries"}:{" "}
                {close.closing_entry_ids.map((entryId, i) => (
                  <span key={entryId}>
                    {i > 0 && ", "}
                    <Link className="underline" href={`/accounts/journals/${entryId}`}>
                      view
                    </Link>
                  </span>
                ))}
                .
              </>
            )}
          </>
        }
        actions={<PrintButton />}
      />
      <CloseReportView report={close.report} />
    </div>
  );
}
