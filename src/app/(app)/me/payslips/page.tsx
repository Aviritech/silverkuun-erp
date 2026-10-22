import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { monthLabel } from "@/modules/hr/payroll/constants";
import { listMyPayslips } from "@/modules/hr/payroll/queries";
import { requireMyEmployee } from "@/modules/me/queries";

export default async function MyPayslipsPage() {
  const { employee } = await requireMyEmployee();
  const payslips = await listMyPayslips(employee.id);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="My payslips" description="Your payslip appears here once that month's payroll is approved." />
      <Card>
        {payslips.length === 0 ? (
          <EmptyState>No payslips yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-silver-50/60 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Month</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">Deductions</th>
                  <th className="px-3 py-2 text-right font-medium">Net pay</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 last:border-0 hover:bg-silver-50/60">
                    <td className="px-3 py-2">
                      <Link href={`/me/payslips/${p.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                        {monthLabel(p.payroll_runs.period)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(p.gross)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {formatMoney(Number(p.pension_employee) + Number(p.nhf) + Number(p.paye) + Number(p.deductions))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{formatMoney(p.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
