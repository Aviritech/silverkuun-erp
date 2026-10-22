import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { recordLeave } from "@/modules/hr/leave/actions";
import { RequestLeaveForm } from "@/modules/hr/leave/components/forms";
import { listColleagues, listHolidays, listLeaveTypes } from "@/modules/hr/leave/queries";
import { hrModule } from "@/modules/hr/module";

export default async function RecordLeavePage() {
  const staff = await requireModule(hrModule);
  if (!staff.permissions.has("hr.manage")) notFound();
  const supabase = await createClient();
  const year = new Date().getFullYear();

  const [employees, { branches }, leaveTypes, colleagues, holidays] = await Promise.all([
    supabase
      .from("employees")
      .select("id, employee_no, first_name, last_name, branch_id")
      .in("status", ["probation", "active"])
      .order("first_name")
      .order("last_name"),
    listOrg(),
    listLeaveTypes(),
    listColleagues(),
    // Last year too, so HR can record leave already taken.
    listHolidays(year - 1, year + 1),
  ]);
  if (employees.error) throw dbFailure(employees.error);

  const branchById = new Map(branches.map((b) => [b.id, b]));
  const options = (employees.data as { id: string; employee_no: string; first_name: string; last_name: string; branch_id: string }[])
    .filter((e) => {
      const branch = branchById.get(e.branch_id);
      return branch && staff.permissions.hasForBranch("hr.manage", branch);
    })
    .map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name} · ${e.employee_no} · ${branchById.get(e.branch_id)?.name}` }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Record leave"
        description="For leave someone asked for on paper, or leave already taken. It goes through the same approval chain as a request made in the ERP."
      />
      <Card>
        <RequestLeaveForm
          action={recordLeave}
          employees={options}
          leaveTypes={leaveTypes
            .filter((t) => t.is_active)
            .map((t) => ({ id: t.id, name: t.name, available: null, document_after_days: t.document_after_days }))}
          colleagues={colleagues}
          holidays={holidays.map((h) => h.holiday_date)}
          submitLabel="Record leave"
        />
      </Card>
    </div>
  );
}
