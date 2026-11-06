import Link from "next/link";
import type { ReactNode } from "react";

/* Building blocks for the department dashboards: figure cards, a money chart and a progress ring. */

const iconPaths = {
  bank: "M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3 3 8h18z",
  savings: "M12 3v18m5-14H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  loan: "M7 17 17 7m0 0H9m8 0v8",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  check: "m5 12 4.5 4.5L19 7",
  alert: "M12 8v5m0 3.5v.5M12 3l9.5 17h-19z",
  bill: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6",
  swap: "M7 7h12m0 0-3-3m3 3-3 3M17 17H5m0 0 3-3m-3 3 3 3",
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
  neutral: "bg-silver-100 text-ink-700",
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
    <Link href={href} className={`${cls} transition-colors hover:border-zinc-400`}>
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
    <p className="mt-4 rounded-lg bg-silver-50 px-4 py-3 text-xs leading-relaxed text-zinc-600">
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
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-silver-100" />
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
        className="text-ink"
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
          <span className="h-2 w-2 rounded-full bg-amber-500" /> Money out
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
        <path d={area} className="fill-silver-100/70" />
        <path d={line("moneyIn")} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-ink" />
        <path d={line("moneyOut")} fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500" />
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.moneyIn)} r="3.5" className="fill-ink">
              <title>{`${p.label}: in ${format(p.moneyIn)}, out ${format(p.moneyOut)}`}</title>
            </circle>
            <circle cx={x(i)} cy={y(p.moneyOut)} r="3" className="fill-amber-500">
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-silver-400">Needs your attention</p>
          <h2 className="mt-2 text-lg font-semibold">{title}</h2>
          <div className="mt-1 text-sm text-silver-300">{children}</div>
        </div>
        <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-white px-2 text-sm font-semibold text-ink">{count}</span>
      </div>
      <Link href={href} className="relative mt-4 inline-flex rounded-md bg-silver-100 px-3 py-1.5 text-xs font-medium text-ink hover:bg-white">
        {cta} →
      </Link>
    </section>
  );
}
