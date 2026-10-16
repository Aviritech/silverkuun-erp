import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { updateMember } from "@/modules/administration/actions";
import { MemberForm } from "@/modules/administration/components/member-form";
import { administrationModule } from "@/modules/administration/module";
import { fullName, getMemberBundle, listBranches } from "@/modules/administration/queries";

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(administrationModule);
  const { id } = await params;
  const bundle = await getMemberBundle(id);
  if (!bundle) notFound();
  const { member } = bundle;

  const branch = (await listBranches()).find((b) => b.id === member.branch_id);
  const isApproved = member.status === "approved";
  const allowed =
    branch &&
    (isApproved
      ? staff.permissions.hasForBranch("members.amend", branch)
      : ["draft", "returned"].includes(member.status) && staff.permissions.hasForBranch("members.manage", branch));
  if (!allowed) notFound();

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${fullName(member)}`} description={isApproved ? "This member is approved. Every change needs a reason." : undefined} />
      <Card>
        <MemberForm
          action={updateMember.bind(null, member.id)}
          member={member}
          requireReason={isApproved}
          submitLabel="Save changes"
        />
      </Card>
    </div>
  );
}
