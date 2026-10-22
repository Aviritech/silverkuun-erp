import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { hrModule } from "@/modules/hr/module";
import { hrReports } from "@/modules/hr/reports";

export default async function HrReportsPage() {
  const staff = await requireModule(hrModule);
  const available = hrReports.filter((r) => staff.permissions.has(r.permission));
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="HR reports"
        description="Staff, leave, payroll, training and commission. Filter by date and branch, then download for Excel or as PDF."
      />
      {available.length === 0 ? (
        <EmptyState>None of the HR reports are open to you.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {available.map((r) => (
            <Link key={r.key} href={`/hr/reports/${r.key}`} className="rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400">
              <h2 className="font-medium">{r.title}</h2>
              <p className="mt-1 text-sm text-zinc-600">{r.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
