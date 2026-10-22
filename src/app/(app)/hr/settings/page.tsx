import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { hrModule } from "@/modules/hr/module";

const SETTINGS = [
  {
    href: "/hr/job-titles",
    title: "Job titles",
    description: "The titles employees hold. Leave requests are routed to approvers by title.",
    permission: "hr.read",
  },
  {
    href: "/hr/settings/leave",
    title: "Leave",
    description: "Leave types and days, the approval chain, and public holidays.",
    permission: "hr.read",
  },
  {
    href: "/hr/payroll/settings",
    title: "Tax and pension",
    description: "PAYE bands, pension, NHF and rent relief rates, each from the month they start.",
    permission: "payroll.read",
  },
];

export default async function HrSettingsPage() {
  const staff = await requireModule(hrModule);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="HR settings"
        description="Changes here are kept in the audit trail. Only the Head of HR (and, for tax, the Financial Controller) can make them."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {SETTINGS.filter((s) => staff.permissions.has(s.permission)).map((s) => (
          <Link key={s.href} href={s.href} className="rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400">
            <h2 className="font-medium">{s.title}</h2>
            <p className="mt-1 text-sm text-zinc-600">{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
