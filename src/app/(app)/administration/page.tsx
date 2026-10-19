import Link from "next/link";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { MEMBER_STATUSES, type MemberStatus } from "@/modules/administration/constants";
import { administrationModule } from "@/modules/administration/module";
import { memberCounts } from "@/modules/administration/queries";

export default async function AdministrationPage() {
  const staff = await requireModule(administrationModule);
  const counts = await memberCounts();
  const canCreate = staff.permissions.has("members.manage");

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Administration"
        description="Member files across the branches you work in."
        actions={canCreate && <ButtonLink href="/administration/members/new">New member</ButtonLink>}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        {(Object.keys(MEMBER_STATUSES) as MemberStatus[]).map((status) => (
          <Link
            key={status}
            href={`/administration/members?status=${status}`}
            className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400"
          >
            <p className="text-sm text-zinc-600">{MEMBER_STATUSES[status].label}</p>
            <p className="mt-1 text-2xl font-semibold">{counts[status]}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
