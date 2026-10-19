import { requireModule } from "@/lib/auth/session";
import { ReportPage } from "@/lib/reports/page";
import { creditModule } from "@/modules/credit/module";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule(creditModule);
  const [{ report }, query] = await Promise.all([params, searchParams]);
  return <ReportPage basePath="/credit" reportKey={report} searchParams={query} />;
}
