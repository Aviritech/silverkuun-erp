import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { SidebarNav } from "@/components/sidebar-nav";
import { getCurrentStaff } from "@/lib/auth/session";
import { visibleModules } from "@/modules/registry";
import { signOut } from "../login/actions";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  const modules = visibleModules(staff.permissions);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="no-print relative bg-ink text-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto">
        <div className="px-5 py-5">
          <Link href="/">
            <BrandLogo />
          </Link>
        </div>
        <div className="mx-5 mb-5 hidden h-px bg-gradient-to-r from-transparent via-ink-600 to-transparent md:block" />
        <SidebarNav modules={modules.map(({ department, name, nav }) => ({ department, name, nav }))} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/90 px-6 py-3 backdrop-blur">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Silverkuun Group</p>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{staff.fullName}</p>
              <p className="text-xs leading-tight text-zinc-500">{staff.email}</p>
            </div>
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-semibold tracking-wide text-silver-200 ring-2 ring-silver-200"
            >
              {initials(staff.fullName)}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
