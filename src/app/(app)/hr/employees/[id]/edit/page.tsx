import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { updateEmployee } from "@/modules/hr/actions";
import { EmployeeForm } from "@/modules/hr/components/employee-form";
import { hrModule } from "@/modules/hr/module";
import { employeeName, getEmployeeBundle } from "@/modules/hr/queries";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(hrModule);
  const { id } = await params;
  const bundle = await getEmployeeBundle(id);
  if (!bundle) notFound();
  const { employee } = bundle;
  const branch = (await listOrg()).branches.find((b) => b.id === employee.branch_id);
  if (!branch || !staff.permissions.hasForBranch("hr.manage", branch)) notFound();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`Edit ${employeeName(employee)}`}
        description="Branch, department, job title and status change through a confirmation, transfer or exit on the employee's page."
      />
      <Card>
        <EmployeeForm
          action={updateEmployee.bind(null, employee.id)}
          employee={employee}
          lockWorkEmail={employee.staff_id !== null}
          submitLabel="Save changes"
        />
      </Card>
    </div>
  );
}
