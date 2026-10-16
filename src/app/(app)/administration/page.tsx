import { requireModule } from "@/lib/auth/session";
import { administrationModule } from "@/modules/administration/module";

export default async function AdministrationPage() {
  await requireModule(administrationModule);
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Administration</h1>
      <p className="mt-2 text-zinc-600">Member onboarding, approvals and contributions arrive here in the next step.</p>
    </div>
  );
}
