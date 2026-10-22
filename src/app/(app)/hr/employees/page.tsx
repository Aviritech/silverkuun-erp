import Link from "next/link";
import { Badge, ButtonLink, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listOrg } from "@/lib/org";
import { EMPLOYEE_STATUSES, type EmployeeStatus } from "@/modules/hr/constants";
import { hrModule } from "@/modules/hr/module";
import { employeeName, listDepartments, listJobTitles, type Employee } from "@/modules/hr/queries";

const PAGE_SIZE = 100;

// "current" (the default) and "left" group the statuses the way HR asks about them.
const STATUS_FILTERS: Record<string, { label: string; statuses: EmployeeStatus[] }> = {
  current: { label: "Current staff", statuses: ["probation", "active"] },
  probation: { label: "On probation", statuses: ["probation"] },
  active: { label: "Confirmed", statuses: ["active"] },
  left: { label: "Have left", statuses: ["resigned", "terminated"] },
  all: { label: "Everyone", statuses: ["probation", "active", "resigned", "terminated"] },
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; branch?: string; department?: string }>;
}) {
  const staff = await requireModule(hrModule);
  const { q, status = "current", branch, department } = await searchParams;
  const filter = STATUS_FILTERS[status] ?? STATUS_FILTERS.current;
  const supabase = await createClient();

  let query = supabase
    .from("employees")
    .select("id, employee_no, status, branch_id, department_code, job_title_id, title, first_name, middle_name, last_name, phone, hire_date")
    .in("status", filter.statuses)
    .order("last_name")
    .order("first_name")
    .limit(PAGE_SIZE);
  if (branch) query = query.eq("branch_id", branch);
  if (department) query = query.eq("department_code", department);
  const search = q?.trim().replace(/[%,()]/g, "");
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,employee_no.ilike.%${search}%,phone.ilike.%${search}%,work_email.ilike.%${search}%`,
    );
  }

  const [{ data, error }, branches, departments, jobTitles] = await Promise.all([query, listOrg().then((o) => o.branches), listDepartments(), listJobTitles()]);
  if (error) throw dbFailure(error);
  const employees = data as Employee[];
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const departmentName = new Map(departments.map((d) => [d.code, d.name]));
  const titleName = new Map(jobTitles.map((t) => [t.id, t.name]));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Employees"
        actions={staff.permissions.has("hr.manage") && <ButtonLink href="/hr/employees/new">New employee</ButtonLink>}
      />
      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <div className="min-w-56 flex-1">
          <Input name="q" defaultValue={q} placeholder="Search name, employee no., phone or email" aria-label="Search" />
        </div>
        <div className="w-40">
          <Select name="status" defaultValue={status} aria-label="Status">
            {Object.entries(STATUS_FILTERS).map(([value, f]) => (
              <option key={value} value={value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select name="branch" defaultValue={branch ?? ""} aria-label="Branch">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select name="department" defaultValue={department ?? ""} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {employees.length === 0 ? (
          <EmptyState>No employees match.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Employee no.</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Hired</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <Link href={`/hr/employees/${e.id}`} className="font-medium hover:underline">
                      {employeeName(e)}
                    </Link>
                    <div className="text-xs text-zinc-500">{titleName.get(e.job_title_id)}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{e.employee_no}</td>
                  <td className="px-4 py-2">{branchName.get(e.branch_id)}</td>
                  <td className="px-4 py-2">{departmentName.get(e.department_code) ?? e.department_code}</td>
                  <td className="px-4 py-2">
                    <Badge tone={EMPLOYEE_STATUSES[e.status].tone}>{EMPLOYEE_STATUSES[e.status].label}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">{formatDate(e.hire_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {employees.length === PAGE_SIZE && (
        <p className="mt-2 text-xs text-zinc-500">Showing the first {PAGE_SIZE}. Search or filter to narrow down.</p>
      )}
    </div>
  );
}
