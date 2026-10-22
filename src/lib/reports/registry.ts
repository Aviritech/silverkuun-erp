import { accountsReports } from "@/modules/accounts/reports";
import { administrationReports } from "@/modules/administration/reports";
import { accountsLoanPortfolio, creditReports } from "@/modules/credit/reports";
import { hrReports } from "@/modules/hr/reports";
import { internalAuditReports } from "@/modules/internal-audit/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportDefinition } from "./types";

export const reports: readonly ReportDefinition[] = [
  ...administrationReports,
  ...accountsReports,
  accountsLoanPortfolio,
  ...internalAuditReports,
  ...creditReports,
  ...hrReports,
];

export function findReport(key: string, basePath?: ReportDefinition["basePath"]): ReportDefinition | undefined {
  return reports.find((r) => r.key === key && (!basePath || r.basePath === basePath));
}

/** The report with any database-driven filter choices filled in, ready for parseFilters and the filter form. */
export async function withLoadedOptions(report: ReportDefinition, supabase: SupabaseClient): Promise<ReportDefinition> {
  if (!report.loadOptions) return report;
  return { ...report, options: [...(report.options ?? []), ...(await report.loadOptions(supabase))] };
}
