import { requireModule, requirePermission } from "@/lib/auth/session";
import { UsageView } from "@/modules/system/components/usage-view";
import { systemModule } from "@/modules/system/module";
import { USAGE_PERMISSION } from "@/modules/system/usage";

export default async function SystemUsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireModule(systemModule);
  await requirePermission(USAGE_PERMISSION);
  return <UsageView basePath="/system/usage" searchParams={await searchParams} />;
}
