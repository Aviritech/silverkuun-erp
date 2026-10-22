import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { branchesWith } from "@/modules/administration/queries";
import { createEmployee } from "@/modules/hr/actions";
import { EmployeeForm } from "@/modules/hr/components/employee-form";
import { hrModule } from "@/modules/hr/module";
import { listDepartments, listJobTitles } from "@/modules/hr/queries";

export default async function NewEmployeePage() {
  const staff = await requireModule(hrModule);
  const branches = await branchesWith(staff.permissions, "hr.manage");
  if (branches.length === 0) notFound();
  const [departments, jobTitles] = await Promise.all([listDepartments(), listJobTitles()]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New employee"
        description="Start their record. You can add documents, a contract and an ERP login once it's saved."
      />
      <Card>
        <EmployeeForm
          action={createEmployee}
          placement={{ branches, departments, jobTitles, canEnterActive: staff.permissions.has("hr.approve") }}
          submitLabel="Create employee record"
        />
      </Card>
    </div>
  );
}
