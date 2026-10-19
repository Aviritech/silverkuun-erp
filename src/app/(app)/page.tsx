import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth/session";
import { visibleModules } from "@/modules/registry";

export default async function HomePage() {
  const staff = await getCurrentStaff();
  const modules = visibleModules(staff.permissions);
  const today = new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });

  return (
    <div className="max-w-5xl">
      <section className="relative overflow-hidden rounded-2xl bg-ink px-8 py-9 text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(236,238,242,0.16),rgba(236,238,242,0)_65%)]"
        />
        <p className="relative text-xs font-medium uppercase tracking-[0.18em] text-silver-400">{today}</p>
        <h1 className="relative mt-2 text-3xl font-semibold tracking-tight">
          Welcome, <span className="silver-text">{staff.fullName.split(" ")[0]}</span>
        </h1>
        <p className="relative mt-2 max-w-xl text-sm text-silver-300">
          Pick a department to carry on with your work. You only see the departments you have access to.
        </p>
      </section>
      {modules.length === 0 ? (
        <p className="mt-6 text-zinc-600">You don&apos;t have access to any department yet. Ask a system administrator.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <Link
              key={m.department}
              href={m.basePath}
              className="group flex flex-col rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,17,20,0.04),0_1px_3px_rgba(16,17,20,0.06)] transition hover:-translate-y-0.5 hover:border-silver-300 hover:shadow-md"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-sm font-semibold text-silver-200">
                {m.name[0]}
              </span>
              <h2 className="mt-4 font-semibold text-ink">{m.name}</h2>
              <p className="mt-1 flex-1 text-sm text-zinc-600">{m.description}</p>
              <span className="mt-4 text-sm font-medium text-ink">
                Open <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
