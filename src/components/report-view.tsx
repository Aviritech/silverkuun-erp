import { filtersToQuery } from "@/lib/reports/filters";
import { describeScope } from "@/lib/reports/scope";
import type { ReportDefinition, ReportFilters, ReportResult } from "@/lib/reports/types";
import type { BranchRef, CodeRef, RegionRef } from "@/lib/org";
import { DataTable } from "./data-table";
import { PrintButton } from "./print-button";
import { ButtonLink, Input, PageHeader, Select } from "./ui";

/** A report page: filters, the table, and downloads as Excel, PDF or CSV. */
export function ReportView({
  report,
  filters,
  result,
  branches,
  regions,
  departments,
  products,
}: {
  report: ReportDefinition;
  filters: ReportFilters;
  result: ReportResult;
  branches: BranchRef[];
  regions: RegionRef[];
  departments: CodeRef[];
  products: CodeRef[];
}) {
  const scope = describeScope(report, filters, { branches, regions, departments, products });
  const download = (format: string) => `/reports/${report.key}/export?${filtersToQuery(filters)}&format=${format}`;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={report.title}
        description={
          <>
            {report.description}
            {scope && <span className="mt-1 block font-medium text-zinc-800">{scope}</span>}
          </>
        }
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <ButtonLink href={download("xlsx")} variant="secondary" prefetch={false}>
              Download Excel
            </ButtonLink>
            <ButtonLink href={download("pdf")} variant="secondary" prefetch={false}>
              Download PDF
            </ButtonLink>
            <a href={download("csv")} className="text-sm underline">
              CSV
            </a>
            <PrintButton />
          </div>
        }
      />
      <form className="no-print mb-4 flex flex-wrap items-end gap-3" role="search">
        {report.dates === "period" && (
          <>
            <label className="text-sm">
              From
              <Input type="date" name="from" defaultValue={filters.from} />
            </label>
            <label className="text-sm">
              To
              <Input type="date" name="to" defaultValue={filters.to} />
            </label>
          </>
        )}
        {report.dates === "range" && (
          <>
            <label className="text-sm">
              Custom from
              <Input type="date" name="from" defaultValue={filters.from} />
            </label>
            <label className="text-sm">
              Custom to
              <Input type="date" name="to" defaultValue={filters.to} />
            </label>
          </>
        )}
        {report.dates === "asAt" && (
          <label className="text-sm">
            As at
            <Input type="date" name="to" defaultValue={filters.to} />
          </label>
        )}
        {report.branchFilter && (
          <>
            <label className="w-44 text-sm">
              Region
              <Select name="region" defaultValue={filters.region ?? ""}>
                <option value="">All regions</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="w-44 text-sm">
              Branch
              <Select name="branch" defaultValue={filters.branch ?? ""}>
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
        {report.dimensionFilters?.includes("department") && (
          <label className="w-44 text-sm">
            Department
            <Select name="department" defaultValue={filters.department ?? ""}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {report.dimensionFilters?.includes("product") && (
          <label className="w-44 text-sm">
            Product
            <Select name="product" defaultValue={filters.product ?? ""}>
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {report.options?.map((o) => (
          <label key={o.name} className="w-48 text-sm">
            {o.label}
            <Select name={o.name} defaultValue={filters.options[o.name]}>
              {o.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
        ))}
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Run report
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <DataTable columns={result.columns} rows={result.rows} empty="Nothing in this report for the filters chosen." />
      </div>
      {result.notes?.map((n) => (
        <p key={n} className="mt-2 text-xs text-zinc-500">
          {n}
        </p>
      ))}
    </div>
  );
}
