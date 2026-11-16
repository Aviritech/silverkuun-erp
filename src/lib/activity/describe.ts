import { myHrNav, speakUpNav } from "@/modules/me/nav";
import { modules } from "@/modules/registry";
import type { ModuleNavItem } from "@/modules/types";

export type PageDescription = { module: string | null; label: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sections: { module: string; basePath: string; nav: ModuleNavItem[] }[] = [
  ...modules.map((m) => ({ module: m.department, basePath: m.basePath, nav: m.nav })),
  { module: "me", basePath: "/me", nav: [...myHrNav, speakUpNav] },
];

const OTHER_PAGES: Record<string, string> = {
  "/": "Home",
  "/account/password": "Change password",
  "/login": "Sign in",
};

const words = (slug: string) => {
  const text = slug.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * A readable name for a page, from the department navigation: "/administration/members/<id>/edit" is
 * "Members · edit record" in Administration. Report pages are named after the report.
 */
export function describePath(path: string, reportTitle?: (key: string) => string | undefined): PageDescription {
  const clean = (path.split(/[?#]/)[0] ?? "/").replace(/\/+$/, "") || "/";
  if (OTHER_PAGES[clean]) return { module: null, label: OTHER_PAGES[clean] };

  const section = sections
    .filter((s) => clean === s.basePath || clean.startsWith(`${s.basePath}/`))
    .sort((a, b) => b.basePath.length - a.basePath.length)[0];
  if (!section) return { module: null, label: clean };

  const report = clean.match(/\/reports\/([a-z0-9-]+)$/);
  if (report) return { module: section.module, label: `Report: ${reportTitle?.(report[1]) ?? words(report[1])}` };

  const item = section.nav
    .filter((n) => n.href.startsWith(section.basePath) && (clean === n.href || clean.startsWith(`${n.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const rest = item ? clean.slice(item.href.length).split("/").filter(Boolean) : clean.slice(section.basePath.length).split("/").filter(Boolean);
  const base = item?.label ?? (rest.length ? words(rest.shift()!) : "Overview");

  let suffix = "";
  if (rest.includes("new")) suffix = "new";
  else if (rest.includes("edit")) suffix = "edit record";
  else if (rest.some((part) => UUID.test(part))) {
    // "/hr/payroll/<id>/payslips/<id>": name the last plain word after the record, if there is one.
    const named = rest.filter((part) => !UUID.test(part));
    suffix = named.length ? `open record · ${words(named[named.length - 1]).toLowerCase()}` : "open record";
  } else if (rest.length) suffix = rest.map((r) => words(r).toLowerCase()).join(" · ");

  return { module: section.module, label: (suffix ? `${base} · ${suffix}` : base).slice(0, 200) };
}
