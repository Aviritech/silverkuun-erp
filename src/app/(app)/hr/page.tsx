import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CONTRACT_TYPES, EMPLOYEE_STATUSES, WATCH_DAYS, type ContractType, type EmployeeStatus } from "@/modules/hr/constants";
import { hrModule } from "@/modules/hr/module";

type Row = { id: string; first_name: string; last_name: string; employee_no: string };

function addDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-silver-300 hover:shadow-sm">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value.toLocaleString("en-NG")}</p>
    </Link>
  );
}

export default async function HrOverviewPage() {
  const staff = await requireModule(hrModule);
  // Reviewers and the Financial Controller open HR for one job; send them straight to it.
  if (!staff.permissions.has("hr.read")) redirect(staff.permissions.has("payroll.read") ? "/hr/payroll" : "/hr/performance");
  const supabase = await createClient();
  const today = addDays(0);
  const horizon = addDays(WATCH_DAYS);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [counts, probation, contracts, joiners, leavers] = await Promise.all([
    supabase.from("employees").select("status"),
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_no, probation_end_date")
      .eq("status", "probation")
      .not("probation_end_date", "is", null)
      .lte("probation_end_date", horizon)
      .order("probation_end_date"),
    supabase
      .from("employee_contracts")
      .select("id, contract_type, end_date, employees!inner(id, first_name, last_name, employee_no, status)")
      .is("terminated_on", null)
      .not("end_date", "is", null)
      .lte("end_date", horizon)
      .in("employees.status", ["probation", "active"])
      .order("end_date"),
    supabase.from("employees").select("id, first_name, last_name, employee_no, hire_date").gte("hire_date", monthStart).order("hire_date"),
    supabase.from("employees").select("id, first_name, last_name, employee_no, exit_date, status").gte("exit_date", monthStart).order("exit_date"),
  ]);
  for (const r of [counts, probation, contracts, joiners, leavers]) if (r.error) throw dbFailure(r.error);

  // Professional certifications that have lapsed or lapse in the next 60 days, for current staff.
  const certifications = await supabase
    .from("employee_qualifications")
    .select("id, qualification, expires_on, employees!inner(id, first_name, last_name, employee_no, status)")
    .not("expires_on", "is", null)
    .lte("expires_on", addDays(60))
    .in("employees.status", ["probation", "active"])
    .order("expires_on");
  if (certifications.error) throw dbFailure(certifications.error);
  type CertificationRow = { id: string; qualification: string; expires_on: string; employees: Row };

  const byStatus = new Map<EmployeeStatus, number>();
  for (const e of (counts.data ?? []) as { status: EmployeeStatus }[]) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
  const current = (byStatus.get("active") ?? 0) + (byStatus.get("probation") ?? 0);

  const name = (e: Row) => (
    <Link href={`/hr/employees/${e.id}`} className="font-medium hover:underline">
      {e.first_name} {e.last_name}
    </Link>
  );
  type ContractRow = { id: string; contract_type: ContractType; end_date: string; employees: Row };

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Human Resources"
        description="Who works here, and what needs attention in the next 30 days."
        actions={staff.permissions.has("hr.manage") && <ButtonLink href="/hr/employees/new">New employee</ButtonLink>}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Current staff" value={current} href="/hr/employees" />
        <Stat label={EMPLOYEE_STATUSES.probation.label} value={byStatus.get("probation") ?? 0} href="/hr/employees?status=probation" />
        <Stat label="Joined this month" value={(joiners.data ?? []).length} href="/hr/employees" />
        <Stat label="Left this month" value={(leavers.data ?? []).length} href="/hr/employees?status=left" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Probation ending">
          {(probation.data ?? []).length === 0 ? (
            <EmptyState>No probations end in the next {WATCH_DAYS} days.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {((probation.data ?? []) as (Row & { probation_end_date: string })[]).map((e) => (
                <li key={e.id} className="flex justify-between gap-4 py-2">
                  {name(e)}
                  <span className={e.probation_end_date < today ? "text-red-700" : "text-zinc-600"}>
                    {e.probation_end_date < today ? "Ended " : "Ends "}
                    {formatDate(e.probation_end_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Contracts ending">
          {(contracts.data ?? []).length === 0 ? (
            <EmptyState>No contracts end in the next {WATCH_DAYS} days.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {((contracts.data ?? []) as unknown as ContractRow[]).map((c) => (
                <li key={c.id} className="flex justify-between gap-4 py-2">
                  <span>
                    {name(c.employees)}
                    <span className="ml-2 text-xs text-zinc-500">{CONTRACT_TYPES[c.contract_type]}</span>
                  </span>
                  <span className={c.end_date < today ? "text-red-700" : "text-zinc-600"}>
                    {c.end_date < today ? "Ended " : "Ends "}
                    {formatDate(c.end_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Certifications expiring">
          {(certifications.data ?? []).length === 0 ? (
            <EmptyState>No certifications expire in the next 60 days.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {((certifications.data ?? []) as unknown as CertificationRow[]).map((c) => (
                <li key={c.id} className="flex justify-between gap-4 py-2">
                  <span>
                    {name(c.employees)}
                    <span className="ml-2 text-xs text-zinc-500">{c.qualification}</span>
                  </span>
                  <span className={c.expires_on < today ? "text-red-700" : "text-zinc-600"}>
                    {c.expires_on < today ? "Expired " : "Expires "}
                    {formatDate(c.expires_on)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
