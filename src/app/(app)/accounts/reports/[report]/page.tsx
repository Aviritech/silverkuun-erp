import { requireModule } from "@/lib/auth/session";
import { ReportPage } from "@/lib/reports/page";
import { accountsModule } from "@/modules/accounts/module";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule(accountsModule);
  const [{ report }, query] = await Promise.all([params, searchParams]);
  return <ReportPage basePath="/accounts" reportKey={report} searchParams={query} />;
}
