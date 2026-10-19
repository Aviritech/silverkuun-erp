"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ModuleNavItem } from "@/modules/types";

type NavModule = { department: string; name: string; nav: ModuleNavItem[] };

/** The best match wins, so /administration/members/123 lights up "Members", not "Overview". */
function activeHref(pathname: string, modules: NavModule[]): string | undefined {
  let best: string | undefined;
  for (const m of modules)
    for (const item of m.nav)
      if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && item.href.length > (best?.length ?? 0))
        best = item.href;
  return best;
}

/** Department navigation for the dark sidebar. Collapses behind a Menu button on small screens. */
export function SidebarNav({ modules }: { modules: NavModule[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = activeHref(pathname, modules);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="absolute right-4 top-4 rounded-md border border-ink-600 px-3 py-1.5 text-xs font-medium text-silver-200 md:hidden"
      >
        {open ? "Close" : "Menu"}
      </button>
      <nav className={`${open ? "block" : "hidden"} space-y-6 px-3 pb-6 md:block`}>
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            pathname === "/" ? "bg-ink-700 font-medium text-white" : "text-silver-300 hover:bg-ink-800 hover:text-white"
          }`}
        >
          Home
        </Link>
        {modules.map((m) => (
          <div key={m.department}>
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-silver-500">{m.name}</p>
            <ul className="mt-2 space-y-0.5">
              {m.nav.map((item) => {
                const isActive = item.href === active;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={`relative block rounded-lg px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-ink-700 font-medium text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-silver-300"
                          : "text-silver-300 hover:bg-ink-800 hover:text-white"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
