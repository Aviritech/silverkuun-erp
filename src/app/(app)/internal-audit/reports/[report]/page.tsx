import { requireModule } from "@/lib/auth/session";
import { ReportPage } from "@/lib/reports/page";
import { internalAuditModule } from "@/modules/internal-audit/module";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule(internalAuditModule);
  const [{ report }, query] = await Promise.all([params, searchParams]);
  return <ReportPage basePath="/internal-audit" reportKey={report} searchParams={query} />;
}
