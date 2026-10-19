import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { creditModule } from "@/modules/credit/module";
import { creditReports } from "@/modules/credit/reports";

export default async function CreditReportsPage() {
  await requireModule(creditModule);
  await requirePermission("credit.read");
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Credit reports"
        description="Filter by period, branch, account officer, loan product and customer category, then download for Excel or as PDF."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {creditReports.map((r) => (
          <Link key={r.key} href={`/credit/reports/${r.key}`} className="rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400">
            <h2 className="font-medium">{r.title}</h2>
            <p className="mt-1 text-sm text-zinc-600">{r.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
