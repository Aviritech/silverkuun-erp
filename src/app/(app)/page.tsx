import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth/session";
import { visibleModules } from "@/modules/registry";

export default async function HomePage() {
  const staff = await getCurrentStaff();
  const modules = visibleModules(staff.permissions);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Welcome, {staff.fullName.split(" ")[0]}</h1>
      {modules.length === 0 ? (
        <p className="mt-2 text-zinc-600">You don&apos;t have access to any department yet. Ask a system administrator.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {modules.map((m) => (
            <Link key={m.department} href={m.basePath} className="rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400">
              <h2 className="font-medium">{m.name}</h2>
              <p className="mt-1 text-sm text-zinc-600">{m.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
