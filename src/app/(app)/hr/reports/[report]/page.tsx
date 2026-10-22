import { requireModule } from "@/lib/auth/session";
import { ReportPage } from "@/lib/reports/page";
import { hrModule } from "@/modules/hr/module";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule(hrModule);
  const [{ report }, query] = await Promise.all([params, searchParams]);
  return <ReportPage basePath="/hr" reportKey={report} searchParams={query} />;
}
