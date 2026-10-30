import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { createMember } from "@/modules/administration/actions";
import { MemberForm } from "@/modules/administration/components/member-form";
import { administrationModule } from "@/modules/administration/module";
import { branchesWith, listCbnBanks } from "@/modules/administration/queries";

export default async function NewMemberPage() {
  const staff = await requireModule(administrationModule);
  const [branches, banks] = await Promise.all([branchesWith(staff.permissions, "members.manage"), listCbnBanks()]);
  if (branches.length === 0) notFound();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New member"
        description="Start the member's file. You'll upload the KYC documents next, then send it to the Branch Manager."
      />
      <Card>
        <MemberForm action={createMember} branches={branches} banks={banks} submitLabel="Create draft file" />
      </Card>
    </div>
  );
}
