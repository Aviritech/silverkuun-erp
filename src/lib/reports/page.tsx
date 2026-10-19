import "server-only";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/report-view";
import { requirePermission } from "@/lib/auth/session";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "./filters";
import { findReport } from "./registry";
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
  const report = findReport(reportKey, basePath);
  if (!report) notFound();
  await requirePermission(report.permission);
  const filters = parseFilters(report, searchParams);
  const supabase = await createClient();
  const [result, org] = await Promise.all([report.run(supabase, filters), listOrg()]);
  return <ReportView report={report} filters={filters} result={result} branches={org.branches} regions={org.regions} />;
}
