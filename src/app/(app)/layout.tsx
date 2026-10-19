import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth/session";
import { visibleModules } from "@/modules/registry";
import { signOut } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  const modules = visibleModules(staff.permissions);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="no-print border-b border-zinc-200 bg-white md:w-60 md:border-b-0 md:border-r">
        <div className="p-4">
          <Link href="/" className="font-semibold">
            Silverkuun ERP
          </Link>
        </div>
        <nav className="space-y-4 px-2 pb-4">
          {modules.map((m) => (
            <div key={m.department}>
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{m.name}</p>
              <ul className="mt-1">
                {m.nav.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="block rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="no-print flex items-center justify-end gap-4 border-b border-zinc-200 bg-white px-6 py-3 text-sm">
          <span className="text-zinc-600">{staff.fullName}</span>
          <form action={signOut}>
            <button type="submit" className="text-zinc-900 underline-offset-4 hover:underline">
              Sign out
            </button>
          </form>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
