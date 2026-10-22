import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { hrModule } from "@/modules/hr/module";
import { Payslip } from "@/modules/hr/payroll/components/payslip";
import { monthLabel } from "@/modules/hr/payroll/constants";
import { getPayslip } from "@/modules/hr/payroll/queries";

export default async function RunPayslipPage({ params }: { params: Promise<{ id: string; lineId: string }> }) {
  await requireModule(hrModule);
  await requirePermission("payroll.read");
  const { id, lineId } = await params;
  const slip = await getPayslip(lineId, { runId: id });
  if (!slip) notFound();

  return (
    <div className="max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={`/hr/payroll/${id}`} className="text-sm text-zinc-600 underline-offset-4 hover:underline">
          Back to the {monthLabel(slip.run.period)} payroll
        </Link>
        <PrintButton label="Print or save as PDF" />
      </div>
      <Payslip slip={slip} />
    </div>
  );
}
