import Link from "next/link";
import type { ReactNode } from "react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_TYPES, EMPLOYMENT_TYPES, ID_TYPES, MARITAL_STATUSES, type DocumentType } from "@/modules/hr/constants";
import { BalancesTable } from "@/modules/hr/leave/components/leave-views";
import { getLeaveBalances, listMyApprovals } from "@/modules/hr/leave/queries";
import { employeeName, listDepartments, listJobTitles } from "@/modules/hr/queries";
import { requireMyEmployee } from "@/modules/me/queries";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

function Stat({ label, value, href, note }: { label: string; value: ReactNode; href: string; note?: string }) {
  return (
    <Link href={href} className="rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-silver-300 hover:shadow-sm">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
    </Link>
  );
}

function label<T extends Record<string, string>>(choices: T, value: string | null) {
  return value ? (choices[value as keyof T] ?? value) : null;
}

type PayslipRow = { id: string; net: number; payroll_runs: { period: string } };

export default async function MyOverviewPage() {
  const { employee: e } = await requireMyEmployee();
  const supabase = await createClient();

  const [balances, approvals, reviews, payslips, documents, { branches }, departments, jobTitles] = await Promise.all([
    getLeaveBalances(e.id),
    listMyApprovals(),
    supabase.from("performance_reviews").select("id", { count: "exact", head: true }).eq("employee_id", e.id).eq("status", "submitted"),
    supabase.from("payroll_lines").select("id, net, payroll_runs!inner(period, status)").eq("employee_id", e.id).eq("payroll_runs.status", "approved"),
    supabase
      .from("employee_documents")
      .select("id, document_type, file_name, storage_path, uploaded_at")
      .eq("employee_id", e.id)
      .order("uploaded_at", { ascending: false }),
    listOrg(),
    listDepartments(),
    listJobTitles(),
  ]);
  for (const r of [reviews, payslips, documents]) if (r.error) throw dbFailure(r.error);

  const latestPayslip = ((payslips.data ?? []) as unknown as PayslipRow[]).sort((a, b) =>
    b.payroll_runs.period.localeCompare(a.payroll_runs.period),
  )[0];
  const docs = (documents.data ?? []) as { id: string; document_type: DocumentType; file_name: string; storage_path: string; uploaded_at: string }[];
  const signed = docs.length ? await supabase.storage.from("hr-documents").createSignedUrls(docs.map((d) => d.storage_path), 120) : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl ?? undefined]));

  const branch = branches.find((b) => b.id === e.branch_id);
  const department = departments.find((d) => d.code === e.department_code);
  const jobTitle = jobTitles.find((t) => t.id === e.job_title_id);
  const monthName = (period: string) =>
    new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}T00:00:00Z`));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={employeeName(e)}
        description={
          <span className="flex flex-wrap gap-x-2">
            <span>{jobTitle?.name}</span>·<span>{department?.name ?? e.department_code}</span>·<span>{branch?.name}</span>
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Leave waiting for my approval"
          value={approvals.length}
          href="/me/approvals"
          note={approvals.length === 0 ? "Nothing to do" : undefined}
        />
        <Stat label="Reviews to acknowledge" value={reviews.count ?? 0} href="/me/performance" />
        <Stat
          label="Latest payslip"
          value={latestPayslip ? formatMoney(latestPayslip.net) : "None yet"}
          href={latestPayslip ? `/me/payslips/${latestPayslip.id}` : "/me/payslips"}
          note={latestPayslip ? `Net pay for ${monthName(latestPayslip.payroll_runs.period)}` : undefined}
        />
      </div>

      <Card
        title={`My leave in ${new Date().getFullYear()}`}
        actions={
          <Link href="/me/leave" className="text-sm font-medium text-ink hover:underline">
            Request leave
          </Link>
        }
      >
        <BalancesTable balances={balances} />
      </Card>

      <Card title="Employment">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label="Employee no.">
            <span className="font-mono">{e.employee_no}</span>
          </Detail>
          <Detail label="Hire date">{formatDate(e.hire_date)}</Detail>
          <Detail label="Employment type">{label(EMPLOYMENT_TYPES, e.employment_type)}</Detail>
          <Detail label="Confirmed">{e.confirmed_on ? formatDate(e.confirmed_on) : e.status === "probation" ? "On probation" : null}</Detail>
        </dl>
      </Card>

      <Card title="My personal details">
        <p className="mb-4 text-sm text-zinc-600">Ask HR to correct anything here.</p>
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label="Date of birth">{e.date_of_birth && formatDate(e.date_of_birth)}</Detail>
          <Detail label="Gender">{e.gender && (e.gender === "female" ? "Female" : "Male")}</Detail>
          <Detail label="Marital status">{label(MARITAL_STATUSES, e.marital_status)}</Detail>
          <Detail label="State of origin">{[e.state_of_origin, e.nationality].filter(Boolean).join(", ")}</Detail>
          <Detail label="Phone">{e.phone}</Detail>
          <Detail label="Work email">{e.work_email}</Detail>
          <Detail label="Personal email">{e.personal_email}</Detail>
          <Detail label="Address">{e.address}</Detail>
          <Detail label="NIN">{e.nin}</Detail>
          <Detail label="Means of ID">{[label(ID_TYPES, e.id_type), e.id_number].filter(Boolean).join(" · ")}</Detail>
          <Detail label="Emergency contact">
            {[e.emergency_contact_name, e.emergency_contact_relationship, e.emergency_contact_phone].filter(Boolean).join(" · ")}
          </Detail>
          <Detail label="Bank">{[e.bank_name, e.bank_account_number].filter(Boolean).join(" · ")}</Detail>
          <Detail label="Tax ID (TIN)">{e.tax_id}</Detail>
          <Detail label="Pension">{[e.pension_administrator, e.pension_pin].filter(Boolean).join(" · ")}</Detail>
        </dl>
      </Card>

      <Card title="My documents">
        {docs.length === 0 ? (
          <EmptyState>No documents on your file yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium">{DOCUMENT_TYPES[d.document_type]}</span>
                  <span className="ml-2 text-zinc-500">
                    {d.file_name} · {formatDate(d.uploaded_at)}
                  </span>
                </div>
                {urls.get(d.storage_path) && (
                  <a href={urls.get(d.storage_path)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                    View
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
