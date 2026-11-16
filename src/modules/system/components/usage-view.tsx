import Link from "next/link";
import { StatCard, StatGrid } from "@/components/dashboard";
import { Badge, ButtonLink, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { listDimensions, listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { listRoles } from "@/modules/system/queries";
import {
  MODULE_NAMES,
  USAGE_KINDS,
  describeEvent,
  loadUsage,
  loadUsageEvents,
  parseUsageFilters,
  usageQuery,
  type DayUsage,
  type UsageKind,
} from "@/modules/system/usage";
import { deviceOf } from "@/lib/activity/device";

const PAGE_SIZE = 100;

const kindTone: Partial<Record<UsageKind, "gray" | "amber" | "red" | "green" | "blue">> = {
  sign_in: "green",
  sign_in_failed: "red",
  sign_out: "gray",
  page_view: "gray",
  change: "blue",
  download: "amber",
  password_changed: "amber",
};

/**
 * The Usage page: who signs in, which pages they open, what they change and download. Shown under System
 * Administration and Internal Audit; the database limits it to people in branches the reader may oversee.
 */
export async function UsageView({
  basePath,
  searchParams,
}: {
  basePath: "/system/usage" | "/internal-audit/usage";
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = parseUsageFilters(searchParams);
  const kind = typeof searchParams.kind === "string" && searchParams.kind in USAGE_KINDS ? searchParams.kind : "all";
  const page = Math.max(1, Math.min(500, Number(searchParams.page) || 1));
  const supabase = await createClient();
  const [{ people, pages, days }, events, { branches }, { departments }, roles] = await Promise.all([
    loadUsage(supabase, filters),
    loadUsageEvents(supabase, filters, { kind, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    listOrg(),
    listDimensions(),
    listRoles(),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const departmentName = new Map(departments.map((d) => [d.code, d.name]));

  const shown = filters.staff ? people.filter((p) => p.staff_id === filters.staff) : people;
  const active = shown.filter((p) => p.last_seen);
  const quiet = shown.filter((p) => !p.last_seen);
  const sum = (key: "sign_ins" | "failed_sign_ins" | "page_views" | "changes" | "downloads") => shown.reduce((t, p) => t + p[key], 0);
  const person = filters.staff ? people.find((p) => p.staff_id === filters.staff) : undefined;
  const href = (extra: Record<string, string | null> = {}) => `${basePath}?${usageQuery(filters, { kind: kind === "all" ? null : kind, ...extra })}`;
  const download = (format: string) => `/usage/export?${usageQuery(filters, { kind: kind === "all" ? null : kind, format })}`;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={person ? `Usage: ${person.full_name}` : "Usage"}
        description={
          <>
            Who signs in, which pages they open, and what they change and download.{" "}
            <span className="font-medium text-zinc-800">
              {formatDate(filters.from)} to {formatDate(filters.to)}
            </span>
          </>
        }
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            {person && (
              <ButtonLink href={href({ staff: null, page: null })} variant="secondary">
                Everyone
              </ButtonLink>
            )}
            <ButtonLink href={download("xlsx")} variant="secondary" prefetch={false}>
              Download Excel
            </ButtonLink>
            <a href={download("csv")} className="text-sm underline">
              CSV
            </a>
          </div>
        }
      />

      <form className="no-print flex flex-wrap items-end gap-3" role="search">
        <label className="text-sm">
          From
          <Input type="date" name="from" defaultValue={filters.from} />
        </label>
        <label className="text-sm">
          To
          <Input type="date" name="to" defaultValue={filters.to} />
        </label>
        <label className="w-44 text-sm">
          Branch
          <Select name="branch" defaultValue={filters.branch ?? ""}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-44 text-sm">
          Department
          <Select name="department" defaultValue={filters.department ?? ""}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-48 text-sm">
          Role
          <Select name="role" defaultValue={filters.role ?? ""}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-52 text-sm">
          Person
          <Select name="staff" defaultValue={filters.staff ?? ""}>
            <option value="">Everyone</option>
            {[...people]
              .sort((a, b) => a.full_name.localeCompare(b.full_name))
              .map((p) => (
                <option key={p.staff_id} value={p.staff_id}>
                  {p.full_name}
                </option>
              ))}
          </Select>
        </label>
        {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
        <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          Show
        </button>
      </form>

      <StatGrid>
        <StatCard
          label={person ? "Days active" : "People active"}
          icon="users"
          value={person ? person.active_days : active.length}
          hint={person ? `Last seen ${person.last_seen ? formatDateTime(person.last_seen) : "never"}` : `${quiet.length} with no activity`}
        />
        <StatCard
          label="Sign-ins"
          icon="key"
          tone={sum("failed_sign_ins") ? "warn" : "neutral"}
          value={sum("sign_ins")}
          hint={`${sum("failed_sign_ins")} failed`}
          href={href({ kind: "sign_in_failed", page: null })}
        />
        <StatCard label="Pages opened" icon="file" value={sum("page_views")} href={href({ kind: "page_view", page: null })} />
        <StatCard
          label="Records changed"
          icon="check"
          value={sum("changes")}
          hint={`${sum("downloads")} report downloads`}
          href={href({ kind: "change", page: null })}
        />
      </StatGrid>

      <Card title="Activity by day">
        <DayChart days={days} from={filters.from} to={filters.to} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Most used pages">
          {pages.length === 0 ? (
            <EmptyState>No pages opened in this period.</EmptyState>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="pb-2 font-medium">Page</th>
                  <th className="pb-2 text-right font-medium">Opened</th>
                  <th className="pb-2 text-right font-medium">People</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {pages.slice(0, 15).map((p) => (
                  <tr key={`${p.module}-${p.label}`}>
                    <td className="py-1.5 pr-2">
                      {p.label}
                      {p.module && <span className="ml-1.5 text-xs text-zinc-500">{MODULE_NAMES[p.module] ?? p.module}</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{p.views}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.people}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={`No activity in this period (${quiet.length})`}>
          {quiet.length === 0 ? (
            <EmptyState>Everyone here used the ERP in this period.</EmptyState>
          ) : (
            <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto text-sm">
              {quiet.map((p) => (
                <li key={p.staff_id} className="flex items-center justify-between gap-3 py-1.5">
                  <span>{p.full_name}</span>
                  <span className="text-right text-xs text-zinc-500">
                    {departmentName.get(p.department_code) ?? p.department_code}
                    {p.branch_id ? ` · ${branchName.get(p.branch_id) ?? ""}` : " · Head office"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {!person && (
        <Card title="People">
          {active.length === 0 ? (
            <EmptyState>Nobody has used the ERP in this period.</EmptyState>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-100 text-zinc-500">
                  <tr>
                    <th className="px-5 pb-2 font-medium">Name</th>
                    <th className="px-2 pb-2 font-medium">Department and branch</th>
                    <th className="px-2 pb-2 text-right font-medium">Days</th>
                    <th className="px-2 pb-2 text-right font-medium">Sign-ins</th>
                    <th className="px-2 pb-2 text-right font-medium">Pages</th>
                    <th className="px-2 pb-2 text-right font-medium">Changes</th>
                    <th className="px-2 pb-2 text-right font-medium">Downloads</th>
                    <th className="px-5 pb-2 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {active.map((p) => (
                    <tr key={p.staff_id} className="hover:bg-zinc-50">
                      <td className="px-5 py-2">
                        <Link href={href({ staff: p.staff_id, page: null, kind: null })} className="font-medium hover:underline">
                          {p.full_name}
                        </Link>
                        {p.failed_sign_ins > 0 && (
                          <span className="ml-2">
                            <Badge tone="red">{p.failed_sign_ins} failed sign-in{p.failed_sign_ins === 1 ? "" : "s"}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-zinc-600">
                        {departmentName.get(p.department_code) ?? p.department_code}
                        {p.branch_id ? ` · ${branchName.get(p.branch_id) ?? ""}` : " · Head office"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.active_days}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.sign_ins}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.page_views}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.changes}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.downloads}</td>
                      <td className="whitespace-nowrap px-5 py-2 text-zinc-600">{formatDateTime(p.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card
        title="Activity"
        actions={
          <form className="no-print flex items-center gap-2">
            <input type="hidden" name="from" value={filters.from} />
            <input type="hidden" name="to" value={filters.to} />
            {filters.staff && <input type="hidden" name="staff" value={filters.staff} />}
            {filters.branch && <input type="hidden" name="branch" value={filters.branch} />}
            {filters.department && <input type="hidden" name="department" value={filters.department} />}
            {filters.role && <input type="hidden" name="role" value={filters.role} />}
            <Select name="kind" defaultValue={kind} aria-label="Show">
              <option value="all">Everything</option>
              {Object.entries(USAGE_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
            <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
              Show
            </button>
          </form>
        }
      >
        {events.length === 0 ? (
          <EmptyState>Nothing recorded for these filters.</EmptyState>
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-100 text-zinc-500">
                  <tr>
                    <th className="px-5 pb-2 font-medium">When</th>
                    <th className="px-2 pb-2 font-medium">Who</th>
                    <th className="px-2 pb-2 font-medium">What</th>
                    <th className="px-2 pb-2 font-medium">Where</th>
                    <th className="px-5 pb-2 font-medium">Device</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {events.slice(0, PAGE_SIZE).map((e, i) => (
                    <tr key={`${e.occurred_at}-${i}`} className="align-top">
                      <td className="whitespace-nowrap px-5 py-1.5 text-zinc-600">{formatDateTime(e.occurred_at)}</td>
                      <td className="px-2 py-1.5">
                        {e.staff_id ? (
                          <Link href={href({ staff: e.staff_id, page: null })} className="hover:underline">
                            {e.staff_name}
                          </Link>
                        ) : (
                          <span className="text-zinc-500">{e.staff_name ?? "Unknown"}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={kindTone[e.kind]}>{USAGE_KINDS[e.kind] ?? e.kind}</Badge>{" "}
                        <span className="text-zinc-800">{e.kind === "page_view" || e.kind === "sign_in" || e.kind === "sign_out" ? "" : describeEvent(e)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-zinc-600">
                        {e.kind === "page_view" ? (
                          <>
                            {e.label}
                            {e.module && <span className="ml-1.5 text-xs text-zinc-500">{MODULE_NAMES[e.module] ?? e.module}</span>}
                          </>
                        ) : e.branch_id ? (
                          branchName.get(e.branch_id)
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-1.5 text-xs text-zinc-500">{deviceOf(e.user_agent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="no-print mt-4 flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={href({ page: String(page - 1) })} className="underline">
                  Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="text-zinc-500">Page {page}</span>
              {events.length > PAGE_SIZE ? (
                <Link href={href({ page: String(page + 1) })} className="underline">
                  Older
                </Link>
              ) : (
                <span />
              )}
            </div>
          </>
        )}
      </Card>
      <p className="text-xs text-zinc-500">
        Pages opened, sign-ins and downloads come from the usage log; record changes come from the audit trail, without the values
        changed. Days run midnight to midnight, Lagos time.
      </p>
    </div>
  );
}

/** People active each day, as bars, with the day's figures on hover. Server-rendered, no chart library. */
function DayChart({ days, from, to }: { days: DayUsage[]; from: string; to: string }) {
  const byDay = new Map(days.map((d) => [d.day.slice(0, 10), d]));
  const all: DayUsage[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && all.length < 120; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    all.push(byDay.get(key) ?? { day: key, people: 0, sign_ins: 0, page_views: 0, changes: 0 });
  }
  const max = Math.max(1, ...all.map((d) => d.people));
  if (!days.length) return <EmptyState>No activity in this period.</EmptyState>;
  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label="People active each day">
        {all.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className="min-h-[2px] rounded-t bg-ink transition-colors group-hover:bg-brand-500"
              style={{ height: `${(d.people / max) * 100}%` }}
              title={`${formatDate(d.day)}: ${d.people} people, ${d.sign_ins} sign-ins, ${d.page_views} pages, ${d.changes} changes`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-zinc-500">
        <span>{formatDate(all[0]?.day)}</span>
        <span>People active each day (most: {max})</span>
        <span>{formatDate(all[all.length - 1]?.day)}</span>
      </div>
    </div>
  );
}
