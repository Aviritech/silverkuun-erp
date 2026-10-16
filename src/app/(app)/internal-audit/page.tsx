import { requireModule } from "@/lib/auth/session";
import { internalAuditModule } from "@/modules/internal-audit/module";

export default async function InternalAuditPage() {
  await requireModule(internalAuditModule);
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Internal Audit</h1>
      <p className="mt-2 text-zinc-600">The audit dashboard and exception reports arrive here in step three.</p>
    </div>
  );
}
