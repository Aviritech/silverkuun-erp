import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { administrationModule } from "@/modules/administration/module";
import { administrationReports } from "@/modules/administration/reports";

export default async function AdministrationReportsPage() {
  await requireModule(administrationModule);
  await requirePermission("members.read");
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Operations reports"
        description="Filter by branch and region, then download for Excel or as a PDF."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {administrationReports.map((r) => (
          <Link
            key={r.key}
            href={`/administration/reports/${r.key}`}
            className="rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400"
          >
            <h2 className="font-medium">{r.title}</h2>
            <p className="mt-1 text-sm text-zinc-600">{r.description}</p>
          </Link>
        ))}
        <Link href="/administration/targets" className="rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400">
          <h2 className="font-medium">Branch targets</h2>
          <p className="mt-1 text-sm text-zinc-600">Monthly registration and collection targets against what each branch achieved.</p>
        </Link>
      </div>
    </div>
  );
}
