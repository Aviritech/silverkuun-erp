import type { BranchRef, CodeRef, RegionRef } from "@/lib/org";
import type { ReportDefinition, ReportFilters } from "./types";

/** One line describing the filters a report was run with, for its header and downloads. */
export function describeScope(
  report: ReportDefinition,
  filters: ReportFilters,
  org: { branches: BranchRef[]; regions: RegionRef[]; departments?: CodeRef[]; products?: CodeRef[] },
): string {
  const options = (report.options ?? [])
    .filter((o) => filters.options[o.name] !== o.choices[0].value)
    .map((o) => `${o.label}: ${o.choices.find((c) => c.value === filters.options[o.name])?.label}`);
  return [
    report.dates === "period" ? `${filters.from} to ${filters.to}` : report.dates === "asAt" ? `As at ${filters.to}` : null,
    filters.region ? org.regions.find((r) => r.id === filters.region)?.name : null,
    filters.branch ? org.branches.find((b) => b.id === filters.branch)?.name : null,
    filters.department ? `${org.departments?.find((d) => d.code === filters.department)?.name ?? filters.department} department` : null,
    filters.product ? `${org.products?.find((p) => p.code === filters.product)?.name ?? filters.product} plans` : null,
    filters.options.account ? `Account ${filters.options.account}` : null,
    ...options,
  ]
    .filter(Boolean)
    .join(" · ");
}
