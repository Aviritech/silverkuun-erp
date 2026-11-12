import "server-only";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/report-view";
import { requirePermission } from "@/lib/auth/session";
import { listDimensions, listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { limitFiltersToBranches, reportBranches } from "./branch-scope";
import { parseFilters } from "./filters";
import { findReport, withLoadedOptions } from "./registry";
import type { ReportDefinition } from "./types";

/** Renders any report under its department's path. Permission is checked before the report runs. */
export async function ReportPage({
  basePath,
  reportKey,
  searchParams,
}: {
  basePath: ReportDefinition["basePath"];
  reportKey: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const found = findReport(reportKey, basePath);
  if (!found) notFound();
  const staff = await requirePermission(found.permission);
  const supabase = await createClient();
  const [report, org, dimensions] = await Promise.all([withLoadedOptions(found, supabase), listOrg(), listDimensions()]);
  // Operations reports are limited to the reader's own branch unless they may see every branch.
  const allowed = reportBranches(report, staff, org.branches);
  const filters = limitFiltersToBranches(parseFilters(report, searchParams), allowed);
  const result = filters
    ? await report.run(supabase, filters)
    : { columns: [], rows: [], notes: ["Your account has no branch, so there is nothing to show. Ask a System Administrator to set your home branch."] };
  return (
    <ReportView
      report={report}
      filters={filters ?? parseFilters(report, {})}
      result={result}
      branches={allowed ?? org.branches}
      regions={allowed ? [] : org.regions}
      ownBranchOnly={allowed !== null}
      departments={dimensions.departments}
      products={dimensions.products}
    />
  );
}
