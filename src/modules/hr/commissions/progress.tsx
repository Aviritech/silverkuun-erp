import { formatMoney } from "@/lib/format";

/** Approved sales (green) and sales waiting for approval (amber) against the target. */
export function TargetProgress({ target, approved, pending }: { target: number; approved: number; pending: number }) {
  const width = (v: number) => `${Math.min(100, target > 0 ? (v / target) * 100 : 0)}%`;
  const percent = target > 0 ? Math.round((approved / target) * 100) : 0;
  return (
    <div className="min-w-40">
      <div className="relative h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 bg-amber-200" style={{ width: width(approved + pending) }} />
        <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: width(approved) }} />
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        {formatMoney(approved)} approved ({percent}%)
        {pending > 0 && <span className="text-amber-800"> · {formatMoney(pending)} waiting</span>}
      </p>
    </div>
  );
}
