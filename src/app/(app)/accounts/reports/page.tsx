import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { accountsModule } from "@/modules/accounts/module";
import { accountsReports } from "@/modules/accounts/reports";
import { accountsLoanPortfolio } from "@/modules/credit/reports";

export default async function AccountsReportsPage() {
  await requireModule(accountsModule);
  await requirePermission("accounts.read");
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Financial reports"
        description="Filter by period, branch and region, then download for Excel or save as PDF. Every figure comes from the posted ledger."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {[...accountsReports, accountsLoanPortfolio].map((r) => (
          <Link key={r.key} href={`/accounts/reports/${r.key}`} className="rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400">
            <h2 className="font-medium">{r.title}</h2>
            <p className="mt-1 text-sm text-zinc-600">{r.description}</p>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-sm text-zinc-500">
        Budget against actual needs an approved budget, which arrives with that workflow. The loan portfolio reads the Credit
        department&apos;s loan book; its disbursements and repayments are the ones posted here.
      </p>
    </div>
  );
}
