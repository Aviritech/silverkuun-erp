import "server-only";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/report-view";
import { requirePermission } from "@/lib/auth/session";
import { listDimensions, listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
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
  await requirePermission(found.permission);
  const supabase = await createClient();
  const report = await withLoadedOptions(found, supabase);
  const filters = parseFilters(report, searchParams);
  const [result, org, dimensions] = await Promise.all([report.run(supabase, filters), listOrg(), listDimensions()]);
  return (
    <ReportView
      report={report}
      filters={filters}
      result={result}
      branches={org.branches}
      regions={org.regions}
      departments={dimensions.departments}
      products={dimensions.products}
    />
  );
}
