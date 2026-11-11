import Link from "next/link";
import type { ReactNode } from "react";

/*
 * Building blocks for the department workspaces (the layout first built for Accounts and Payments):
 * a greeting header, figure cards, work queues, the dark "needs your attention" panel, an activity list,
 * a money chart and a progress ring. Every department overview is made from these, so they look alike.
 */

/** "Good morning" / "Good afternoon" / "Good evening" in Lagos time. */
export function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** "Wednesday 11 November 2026 · Credit": the small line above a workspace greeting. */
export function workspaceEyebrow(department: string, now = new Date()): string {
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(now);
  return `${date} · ${department}`;
}

export const firstName = (fullName: string) => fullName.split(/\s+/)[0] ?? fullName;

const iconPaths = {
  bank: "M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3 3 8h18z",
  savings: "M12 3v18m5-14H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  loan: "M7 17 17 7m0 0H9m8 0v8",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  check: "m5 12 4.5 4.5L19 7",
  alert: "M12 8v5m0 3.5v.5M12 3l9.5 17h-19z",
  bill: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6",
  swap: "M7 7h12m0 0-3-3m3 3-3 3M17 17H5m0 0 3-3m-3 3 3 3",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm10 9v-1.5a3.5 3.5 0 0 0-2.5-3.36M15 4.14a3.5 3.5 0 0 1 0 6.72",
  shield: "M12 3 4.5 6v5.5c0 4.4 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5.1 7.5-9.5V6z",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5M9 13h6m-6 4h4",
  calendar: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14",
  key: "M15 7a3 3 0 1 1-3.2 4.2L4 19v2h3v-2h2v-2h2l1.8-1.8A3 3 0 0 1 15 7z",
} as const;
export type IconName = keyof typeof iconPaths;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={iconPaths[name]} />
    </svg>
  );
}

const toneStyles = {
  neutral: "bg-brand-100 text-ink",
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-700",
};
export type Tone = keyof typeof toneStyles;

/** One headline figure: a label, the value, a line of context, and optionally a link to the work behind it. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-zinc-600">{label}</p>
        {icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneStyles[tone]}`}>
            <Icon name={icon} />
          </span>
        )}
      </div>
      <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight text-ink tabular-nums">{value}</p>
      {hint && <p className="mt-2.5 text-xs text-zinc-500">{hint}</p>}
    </>
  );
  const cls =
    "block rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,17,20,0.04),0_1px_3px_rgba(16,17,20,0.06)]";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-brand`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

/** A shaded note under a table, for the control that the screen enforces. */
export function ControlNote({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <p className="mt-4 rounded-lg bg-neutral-50 px-4 py-3 text-xs leading-relaxed text-zinc-600">
      {title && <span className="font-semibold text-ink">{title}: </span>}
      {children}
    </p>
  );
}

/** A ring showing how much of something is done, such as bank lines matched. */
export function ProgressRing({ percent, size = 64 }: { percent: number; size?: number }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={`${p}%`} className="shrink-0">
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-neutral-100" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(c * p) / 100} ${c}`}
        transform="rotate(-90 32 32)"
        className="text-brand-500"
      />
      <text x="32" y="36" textAnchor="middle" className="fill-ink text-[12px] font-semibold">
        {p}%
      </text>
    </svg>
  );
}

export type ChartPoint = { label: string; moneyIn: number; moneyOut: number };

/**
 * Money in and money out by month, drawn as two lines. Server-rendered SVG, so it needs no chart library;
 * each point carries a tooltip with the exact figures.
 */
export function MoneyChart({ points, format }: { points: ChartPoint[]; format: (n: number) => string }) {
  const W = 640;
  const H = 200;
  const pad = { top: 12, right: 12, bottom: 28, left: 56 };
  const max = Math.max(1, ...points.flatMap((p) => [p.moneyIn, p.moneyOut]));
  const step = (W - pad.left - pad.right) / Math.max(1, points.length - 1);
  const x = (i: number) => pad.left + i * step;
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / max);
  const line = (key: "moneyIn" | "moneyOut") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const area = `${line("moneyIn")} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const ticks = [0, 0.5, 1].map((f) => max * f);

  return (
    <div>
      <div className="mb-2 flex justify-end gap-4 text-xs text-zinc-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ink" /> Money in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-500" /> Money out
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Money in and money out by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-zinc-100" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" className="fill-zinc-400 text-[10px]">
              {format(t)}
            </text>
          </g>
        ))}
        <path d={area} className="fill-neutral-100" />
        <path d={line("moneyIn")} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-ink" />
        <path d={line("moneyOut")} fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-500" />
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.moneyIn)} r="3.5" className="fill-ink">
              <title>{`${p.label}: in ${format(p.moneyIn)}, out ${format(p.moneyOut)}`}</title>
            </circle>
            <circle cx={x(i)} cy={y(p.moneyOut)} r="3" className="fill-brand-500">
              <title>{`${p.label}: in ${format(p.moneyIn)}, out ${format(p.moneyOut)}`}</title>
            </circle>
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-zinc-500 text-[11px]">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** The dark "needs your attention" panel. */
export function AttentionPanel({ count, title, children, href, cta }: { count: number; title: string; children: ReactNode; href: string; cta: string }) {
  return (
    <section className="relative overflow-hidden rounded-xl bg-ink p-5 text-white">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full border-[18px] border-ink-700" aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">Needs your attention</p>
          <h2 className="mt-2 text-lg font-semibold">{title}</h2>
          <div className="mt-1 text-sm text-neutral-300">{children}</div>
        </div>
        <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-brand px-2 text-sm font-semibold text-ink">{count}</span>
      </div>
      <Link href={href} className="relative mt-4 inline-flex rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-ink hover:bg-brand-300">
        {cta} →
      </Link>
    </section>
  );
}

export type WorkQueue = { label: string; value: number; href: string; hint?: string };

/**
 * "Your work": one tile per queue the signed-in person works, with how many items are in it.
 * A queue with items gets a yellow edge so the busy ones stand out.
 */
export function WorkQueues({ queues, title = "Your work" }: { queues: WorkQueue[]; title?: string }) {
  if (queues.length === 0) return null;
  const cols = queues.length >= 5 ? "lg:grid-cols-5" : queues.length === 4 ? "lg:grid-cols-4" : queues.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return (
    <section className="rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(16,17,20,0.04),0_1px_3px_rgba(16,17,20,0.06)]">
      <div className="border-b border-zinc-100 px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      </div>
      <div className={`grid gap-3 p-5 sm:grid-cols-2 ${cols}`}>
        {queues.map((q) => (
          <Link
            key={q.label}
            href={q.href}
            className={`rounded-lg border px-4 py-3 transition-colors hover:border-ink ${
              q.value > 0 ? "border-l-4 border-zinc-100 border-l-brand bg-brand-50" : "border-zinc-100 bg-neutral-50"
            }`}
          >
            <p className="text-xs text-zinc-600">{q.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{q.value.toLocaleString("en-NG")}</p>
            {q.hint && <p className="mt-0.5 text-[11px] text-zinc-500">{q.hint}</p>}
          </Link>
        ))}
      </div>
    </section>
  );
}

export type ActivityItem = {
  key: string;
  title: ReactNode;
  href?: string;
  /** A short line under the title: date, branch, who did it. */
  meta?: ReactNode;
  /** Shown on the right, such as a status badge or an amount. */
  aside?: ReactNode;
};

/** A plain list of recent records for the bottom of a workspace. */
export function ActivityList({ items, empty }: { items: ActivityItem[]; empty: ReactNode }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-zinc-500">{empty}</p>;
  return (
    <ul className="-mx-5 -my-5 divide-y divide-zinc-100">
      {items.map((i) => (
        <li key={i.key} className="flex items-start justify-between gap-4 px-5 py-3 text-sm hover:bg-zinc-50">
          <div className="min-w-0">
            {i.href ? (
              <Link href={i.href} className="font-medium text-ink hover:underline">
                {i.title}
              </Link>
            ) : (
              <span className="font-medium text-ink">{i.title}</span>
            )}
            {i.meta && <p className="mt-0.5 text-xs text-zinc-500">{i.meta}</p>}
          </div>
          {i.aside && <div className="shrink-0 text-right">{i.aside}</div>}
        </li>
      ))}
    </ul>
  );
}

/** Numbered steps showing how work moves through a department, for the foot of a workspace. */
export function ProcessSteps({ title, note, steps }: { title: string; note?: string; steps: { title: string; text: string }[] }) {
  const cols = steps.length >= 6 ? "lg:grid-cols-6" : steps.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4";
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {note && <p className="text-xs text-zinc-500">{note}</p>}
      </div>
      <ol className={`grid gap-3 sm:grid-cols-3 ${cols}`}>
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-zinc-200/80 bg-white p-4">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-600">{String(i + 1).padStart(2, "0")}</p>
            <p className="mt-1.5 text-sm font-semibold text-ink">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
