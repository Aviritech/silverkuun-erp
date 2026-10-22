import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { Payslip } from "@/modules/hr/payroll/components/payslip";
import { getPayslip } from "@/modules/hr/payroll/queries";
import { requireMyEmployee } from "@/modules/me/queries";

export default async function MyPayslipPage({ params }: { params: Promise<{ lineId: string }> }) {
  const { employee } = await requireMyEmployee();
  const { lineId } = await params;
  // Row level security only shows your own payslips, and only once the payroll is approved.
  const slip = await getPayslip(lineId, { employeeId: employee.id });
  if (!slip || slip.run.status !== "approved") notFound();

  return (
    <div className="max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href="/me/payslips" className="text-sm text-zinc-600 underline-offset-4 hover:underline">
          All my payslips
        </Link>
        <PrintButton label="Print or save as PDF" />
      </div>
      <Payslip slip={slip} />
    </div>
  );
}
