import { requireModule } from "@/lib/auth/session";
import { ReportPage } from "@/lib/reports/page";
import { administrationModule } from "@/modules/administration/module";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule(administrationModule);
  const [{ report }, query] = await Promise.all([params, searchParams]);
  return <ReportPage basePath="/administration" reportKey={report} searchParams={query} />;
}
