import { requireModule, requirePermission } from "@/lib/auth/session";
import { internalAuditModule } from "@/modules/internal-audit/module";
import { UsageView } from "@/modules/system/components/usage-view";
import { USAGE_PERMISSION } from "@/modules/system/usage";

export default async function InternalAuditUsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireModule(internalAuditModule);
  await requirePermission(USAGE_PERMISSION);
  return <UsageView basePath="/internal-audit/usage" searchParams={await searchParams} />;
}
