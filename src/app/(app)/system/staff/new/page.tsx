import { Card, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { createStaffLogin } from "@/modules/system/actions";
import { NewStaffForm } from "@/modules/system/components/forms";
import { systemModule } from "@/modules/system/module";
import { listAllDepartments } from "@/modules/system/queries";

export default async function NewStaffLoginPage() {
  await requireModule(systemModule);
  await requirePermission("staff.manage");
  const [departments, { branches }] = await Promise.all([listAllDepartments(), listOrg()]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New login"
        description="For people who need the ERP but aren't employees, such as an external auditor. Employees should get their login from HR, on their employee record, so it stays in step with their job."
      />
      <Card>
        <NewStaffForm action={createStaffLogin} departments={departments.filter((d) => d.is_active)} branches={branches} />
      </Card>
    </div>
  );
}
