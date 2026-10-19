import { accountsReports } from "@/modules/accounts/reports";
import { internalAuditReports } from "@/modules/internal-audit/reports";
import type { ReportDefinition } from "./types";

export const reports: readonly ReportDefinition[] = [...accountsReports, ...internalAuditReports];

export function findReport(key: string, basePath?: ReportDefinition["basePath"]): ReportDefinition | undefined {
  return reports.find((r) => r.key === key && (!basePath || r.basePath === basePath));
}
